// MCP SDK — McpServer manages tool registration; StdioServerTransport handles
// communication with Claude Code over stdin/stdout
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// zod — validates and documents the input parameters for each tool
import { z } from "zod";

// Node built-ins — fs for reading files, path for building safe file paths
import fs from "fs/promises";
import path from "path";

// Absolute path to the files/ folder inside this project.
// import.meta.url gives us the location of this file so the path works
// regardless of where the server is launched from.
const FILES_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), "files");

// --- Create the MCP server ---
// The name and version are sent to Claude Code during the MCP handshake
// so it knows which server it is connected to.
const server = new McpServer({
  name: "my-server",
  version: "1.0.0",
});

// ─── Tool 1: get_weather ──────────────────────────────────────────────────────
// Fetches live weather for any location using the OpenWeatherMap API.
const WEATHER_API_KEY = "9e16d62c8463bb8555971f49447c76e1";

server.registerTool(
  "get_weather",
  {
    description: "Get the current weather for any city or location",
    inputSchema: {
      location: z.string().describe("City name or location, e.g. 'Tampa' or 'London'"),
    },
  },
  async ({ location }) => {
    const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(location)}&appid=${WEATHER_API_KEY}&units=imperial`;

    const response = await fetch(url);

    if (!response.ok) {
      return {
        content: [{
          type: "text",
          text: `Failed to fetch weather for "${location}": HTTP ${response.status}`,
        }],
      };
    }

    const data = await response.json();

    const city = data.name;
    const country = data.sys.country;
    const description = data.weather[0].description;
    const tempF = data.main.temp.toFixed(1);
    const tempC = ((data.main.temp - 32) * 5 / 9).toFixed(1);
    const feelsLikeF = data.main.feels_like.toFixed(1);
    const humidity = data.main.humidity;
    const windMph = data.wind.speed.toFixed(1);
    const visibility = data.visibility ? (data.visibility / 1000).toFixed(1) : "N/A";

    const summary = [
      `Weather for ${city}, ${country}`,
      `Condition:   ${description}`,
      `Temperature: ${tempC}°C / ${tempF}°F (feels like ${feelsLikeF}°F)`,
      `Humidity:    ${humidity}%`,
      `Wind:        ${windMph} mph`,
      `Visibility:  ${visibility} km`,
    ].join("\n");

    return {
      content: [{ type: "text", text: summary }],
    };
  }
);

// ─── Tool 2: read_file ────────────────────────────────────────────────────────
// Reads a text file from the files/ folder inside this project and returns its contents.
// Access is restricted to that directory — filenames that try to escape it
// (e.g. "../../secrets.txt") are rejected before any disk access.
server.registerTool(
  "read_file",
  {
    description: "Read a text file from the files/ folder inside this project",
    inputSchema: {
      filename: z.string().describe("The filename to read, e.g. 'aboutme.txt'"),
    },
  },
  async ({ filename }) => {
    // path.resolve turns the filename into an absolute path.
    // startsWith(FILES_DIR) is the path-traversal guard — if the resolved path
    // escapes FILES_DIR, we block the request immediately.
    const filepath = path.resolve(FILES_DIR, filename);
    if (!filepath.startsWith(FILES_DIR)) {
      return {
        content: [{ type: "text", text: "Access denied: path is outside the files directory." }],
      };
    }

    try {
      // Read the file as a UTF-8 string and return its full contents
      const content = await fs.readFile(filepath, "utf-8");
      return {
        content: [{ type: "text", text: content }],
      };
    } catch {
      // File not found — return a descriptive message instead of crashing the server
      return {
        content: [{ type: "text", text: `File not found: "${filename}" does not exist in the files/ directory` }],
      };
    }
  }
);

// --- Start the server using stdio transport ---
// StdioServerTransport wires the server to process.stdin / process.stdout.
// Claude Code launches this file as a child process and sends tool calls
// over those streams using the MCP protocol.
const transport = new StdioServerTransport();
await server.connect(transport);
