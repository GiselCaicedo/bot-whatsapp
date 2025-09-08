import sql from "mssql";
import {
    DB_DATABASE,
    DB_SERVER,
    DB_PASSWORD,
    DB_USER,
  } from "../../config.js";

const dbSettings = {
    user: DB_USER,
    password: DB_PASSWORD,
    server: DB_SERVER,
    database: DB_DATABASE,

    pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000
    },
    options: {
        encrypt: false,
        enableArithAbort: true,
        trustServerCertificate: true
    },
    requestTimeout: 60000
}


export async function getConnection() {
 try {
    const pool = await sql.connect(dbSettings)
   
    
    return pool
 } catch (error) {
    console.log(error)
 }  
}

export { sql };