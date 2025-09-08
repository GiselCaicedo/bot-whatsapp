import app from "./src/app.js";
import { createServer } from "http";
import { initSocket } from "./src/socket.js";

const server = createServer(app);
initSocket(server);

server.listen(app.get("port"));
console.log('Server on port', app.get("port"));
