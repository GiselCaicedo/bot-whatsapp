import app from "./src/app.js";

app.listen(app.get("port"))
console.log('Server on port', app.get("port"));