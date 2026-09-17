import { config } from "dotenv";
config({ path: ".env.local" });
import { Redis } from "@upstash/redis";
const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
const cursor = await redis.get("stuckstonks:scan-cursor");
console.log("current cursor:", cursor);
