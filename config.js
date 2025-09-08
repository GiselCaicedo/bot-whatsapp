import dotenv from "dotenv";
// leer json
dotenv.config();

const {
  DB_SERVER,
  DB_USER,
  DB_PASSWORD,
  DB_DATABASE,
  DB_PORT,
  TOKEN_SECRET,
  

} = process.env;



export {
  DB_SERVER,
  DB_USER,
  DB_PASSWORD,
  DB_DATABASE,
  DB_PORT,
  TOKEN_SECRET,
}
  
