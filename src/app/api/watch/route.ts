import { exec } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { loadAllowedRoots } from "@/lib/allowed-roots";
import chokidar from "chokidar";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type WatchEvent = {
  event: "add" | "unlink" | "addDir" | "unlinkDir" | "ready";
  root?: string;
  path?: string;
};

const SUPPORTED = /\.(html?|md|markdown)$/i;
const IGNORED_DIRS = new Set(["node_modules", "__pycache__"]);

// fsevents don't propagate across network mounts, so chokidar would fall back
// to recursively scanning (and polling) the whole tree over the wire — for a
// large remote folder that saturates the event loop and wedges the server.
// Roots on network filesystems are simply not live-watched; edits still work,
// the sidebar just won't auto-refresh on external changes for those roots.
const NETWORK_FS = /^(smbfs|afpfs|nfs|webdav)/;

async function networkMountPoints(): Promise<string[]> {
  try {
    // Absolute path: under launchd the PATH may not include /sbin, and a
    // failed lookup would silently disable the network-mount exclusion.
    const { stdout } = await promisify(exec)("/sbin/mount");
    return stdout.split("\n").flatMap((line) => {
      const m = line.match(/ on (\/.+) \(([^,)]+)/);
      return m && NETWORK_FS.test(m[2]) ? [m[1]] : [];
    });
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  const roots = await loadAllowedRoots();
  const netMounts = await networkMountPoints();
  const rootPaths = roots
    .map((r) => r.path)
    .filter((p) => !netMounts.some((mp) => p === mp || p.startsWith(`${mp}/`)));

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;

      const send = (data: WatchEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          /* controller already closed */
        }
      };

      // initial comment to flush headers
      controller.enqueue(encoder.encode(": connected\n\n"));

      if (rootPaths.length === 0) {
        send({ event: "ready" });
        return;
      }

      const watcher = chokidar.watch(rootPaths, {
        ignoreInitial: true,
        persistent: true,
        ignored: (p, stats) => {
          const base = path.basename(p);
          if (base.startsWith(".") || IGNORED_DIRS.has(base)) return true;
          if (!stats) return false;
          if (stats.isDirectory()) return false;
          return !SUPPORTED.test(p);
        },
        depth: 99,
        awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 30 },
      });

      const findRoot = (full: string) =>
        rootPaths.find((r) => full === r || full.startsWith(`${r}/`));

      watcher.on("add", (p) => send({ event: "add", path: p, root: findRoot(p) }));
      watcher.on("unlink", (p) => send({ event: "unlink", path: p, root: findRoot(p) }));
      watcher.on("addDir", (p) => send({ event: "addDir", path: p, root: findRoot(p) }));
      watcher.on("unlinkDir", (p) => send({ event: "unlinkDir", path: p, root: findRoot(p) }));
      watcher.on("ready", () => send({ event: "ready" }));

      // heartbeat every 25s to keep connection alive through proxies
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          /* closed */
        }
      }, 25_000);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        watcher.close().catch(() => {});
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      req.signal.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
