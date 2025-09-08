import express from 'express';
import morgan from "morgan";
import whatsappRoutes from "./routes/whatsapp.routes.js";
import http from 'http';
import { Server } from 'socket.io';

const app = express();

// Configuración del puerto
app.set('port', 5000);

// Middlewares en el orden correcto
app.use(morgan("dev"));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static('public'));

// Rutas
app.use(whatsappRoutes);

// Crear servidor HTTP y Socket.IO
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST", "PUT", "DELETE"],
        credentials: true
    }
});

// Socket.IO connection handler
io.on('connection', (socket) => {
    console.log('Nuevo cliente conectado: ' + socket.id);
    
    socket.on('disconnect', () => {
        console.log('Cliente desconectado: ' + socket.id);
    });
});

export default app;
export { server, io };