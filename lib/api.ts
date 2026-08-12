import { NextResponse } from "next/server";

export function ok(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export function serverError(e: unknown) {
  const message = e instanceof Error ? e.message : "Unexpected error";
  return NextResponse.json({ error: message }, { status: 500 });
}
