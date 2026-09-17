import http from "node:http";
import { WebSocketServer } from "ws";

const PORT = Number(process.env.PORT || process.env.FLY_PORT || 8080);
const startedAt = new Date().toISOString();

const server = http.createServer((req, res) => {
  const url = req.url?.split("?")[0] || "/";
  if (url === "/health" || url === "/") {
    const body = JSON.stringify({
      ok: true,
      service: "selva-oscura-server",
      status: "stub",
      startedAt,
    });
    res.writeHead(200, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    res.end(body);
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: false, error: "not_found" }));
});

const wss = new WebSocketServer({ server, path: "/ws" });
wss.on("connection", (socket) => {
  socket.send(JSON.stringify({ type: "hello", service: "selva-oscura-server", status: "stub" }));
  socket.on("message", (data) => {
    socket.send(JSON.stringify({ type: "echo", data: String(data) }));
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`selva-oscura stub listening on ${PORT}`);
});
