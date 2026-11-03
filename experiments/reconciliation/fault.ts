import { DatabaseSync } from "node:sqlite";
const [file, version, fault = "none"] = process.argv.slice(2);
if (!["1", "2"].includes(version)) throw new Error("supported version required");
const db = new DatabaseSync(file);
db.prepare("UPDATE control SET version=?, fault=?").run(Number(version), fault);
db.close();
