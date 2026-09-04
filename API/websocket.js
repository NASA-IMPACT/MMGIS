const WebSocket = require("isomorphic-ws");
const logger = require("./logger");

const websocket = {
  wss: null,
  init: function (server) {
    logger("info", "Trying to init websocket...", "websocket", null, "");

    if (!server === null) {
      logger(
        "websocket_error",
        "server parameter not defined.",
        "error",
        null,
        ""
      );
      return null;
    }

    logger(
      "info",
      "Server is valid so still trying to init websocket...",
      "websocket",
      null,
      ""
    );

    const wss = new WebSocket.Server({ noServer: true });
    websocket.wss = wss;

    // Heartbeat: proxies and load balancers silently drop idle connections,
    // so periodically ping every client and terminate the ones that stopped
    // answering. Browsers answer pings automatically.
    const pingIntervalMs =
      parseInt(process.env.WEBSOCKET_PING_INTERVAL_MS, 10) || 30000;
    const heartbeatInterval = setInterval(() => {
      wss.clients.forEach((client) => {
        if (client.isAlive === false) {
          client.terminate();
          return;
        }
        client.isAlive = false;
        client.ping();
      });
    }, pingIntervalMs);

    // Broadcast to all clients
    wss.broadcast = function broadcast(data, isBinary) {
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN && data !== undefined) {
          client.send(data, { binary: isBinary });
        }
      });
    };

    wss.on("connection", (ws) => {
      ws.isAlive = true;
      ws.on("pong", () => {
        ws.isAlive = true;
      });
      ws.on("message", (message) => {
        wss.broadcast(message);
      });
    });

    server.on("upgrade", function upgrade(request, socket, head) {
      const pathname = request.url;
      try {
        if (
          pathname ===
          (process.env.WEBSOCKET_ROOT_PATH || process.env.ROOT_PATH || "") + "/"
        ) {
          wss.handleUpgrade(request, socket, head, function done(ws) {
            wss.emit("connection", ws, request);
          });
        } else {
          socket.destroy();
        }
      } catch (err) {
        socket.destroy();
      }
    });

    wss.on("close", () => {
      logger("info", "Websocket disconnected...", "websocket", null, "");
      clearInterval(heartbeatInterval);
      websocket.wss = null;
    });
  },
};

module.exports = { websocket };
