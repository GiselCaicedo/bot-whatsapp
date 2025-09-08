import express from 'express';
import morgan from 'morgan';
import whatsappRoutes from './routes/whatsapp.routes.js';
import { PORT } from '../config.js';

const app = express();
app.set('port', PORT);
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static('public'));
app.use(whatsappRoutes);

export default app;
