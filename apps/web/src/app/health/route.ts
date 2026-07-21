import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    status: "ok",
    service: "web",
    version: process.env.npm_package_version ?? "0.1.0",
  });
}
