import { NextResponse } from "next/server";
import { races } from "@/lib/mockData";

export async function GET() {
  return NextResponse.json(races);
}