import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';

let baseDirectory = '.';
let port = 8080;
let host = '127.0.0.1';
for(let i = 0; i < process.argv.length; ++i) {
  if (process.argv[i] == '-d' && i < process.argv.length - 1) {
    baseDirectory = process.argv[i + 1];
  }
  if (process.argv[i] == '-p' && i < process.argv.length - 1) {
    port = process.argv[i + 1];
  }
  if (process.argv[i] == '-h' && i < process.argv.length - 1) {
    host = process.argv[i + 1];
  } 
}

http
  .createServer(function (request, response) {

    response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    response.setHeader("Cross-Origin-Embedder-Policy", "require-corp");

    let filePath = baseDirectory + request.url;
    if (filePath == "./") filePath = "./index.html";

    const extname = path.extname(filePath);
    let contentType = "text/html";
    switch (extname) {
      case ".js":
        contentType = "text/javascript";
        break;
      case ".css":
        contentType = "text/css";
        break;
      case ".json":
        contentType = "application/json";
        break;
      case ".png":
        contentType = "image/png";
        break;
      case ".jpg":
        contentType = "image/jpg";
        break;
    }

    fs.readFile(filePath, function (error, content) {
      if (error) {
        if (error.code == "ENOENT") {
          fs.readFile("./404.html", function (error, content) {
            response.writeHead(200, { "Content-Type": contentType });
            response.end(content, "utf-8");
          });
        } else {
          response.writeHead(500);
          response.end(
            "Sorry, check with the site admin for error: " +
              error.code +
              " ..\n"
          );
          response.end();
        }
      } else {
        console.log("SUCCESS! Request for " + filePath);
        response.writeHead(200, { "Content-Type": contentType });
        response.end(content, "utf-8");
      }
    });
  })
  .listen(port, host);
console.log("Server running at " + host + ':' + port);