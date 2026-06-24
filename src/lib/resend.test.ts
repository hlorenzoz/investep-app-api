import { afterEach, describe, expect, it, mock } from "bun:test";
import type { AppError } from "./errors";
import { sendEmail } from "./resend";

const CONFIG = {
  RESEND_API_KEY: "re_test_key",
  RESEND_FROM: "Investep <no-reply@investep.app>",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("sendEmail", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("envía el correo y devuelve el id que asigna Resend", async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    globalThis.fetch = mock(async (url: string, init: RequestInit) => {
      captured = { url, init };
      return jsonResponse({ id: "re_123" });
    }) as unknown as typeof fetch;

    const result = await sendEmail(CONFIG, {
      to: "user@example.com",
      subject: "Hola",
      html: "<p>Hola</p>",
    });

    expect(result).toEqual({ id: "re_123" });
    expect(captured?.url).toBe("https://api.resend.com/emails");
    expect(captured?.init.method).toBe("POST");

    const headers = captured?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer re_test_key");

    const payload = JSON.parse(captured?.init.body as string);
    expect(payload).toMatchObject({
      from: CONFIG.RESEND_FROM,
      to: "user@example.com",
      subject: "Hola",
      html: "<p>Hola</p>",
    });
    expect(payload.text).toBeUndefined();
  });

  it("soporta text plano, reply_to, remitente custom y múltiples destinatarios", async () => {
    let payload: Record<string, unknown> = {};
    globalThis.fetch = mock(async (_url: string, init: RequestInit) => {
      payload = JSON.parse(init.body as string);
      return jsonResponse({ id: "re_456" });
    }) as unknown as typeof fetch;

    await sendEmail(CONFIG, {
      to: ["a@example.com", "b@example.com"],
      subject: "Reporte",
      text: "Texto plano",
      replyTo: "soporte@investep.app",
      from: "Custom <custom@investep.app>",
    });

    expect(payload.from).toBe("Custom <custom@investep.app>");
    expect(payload.to).toEqual(["a@example.com", "b@example.com"]);
    expect(payload.text).toBe("Texto plano");
    expect(payload.reply_to).toBe("soporte@investep.app");
    expect(payload.html).toBeUndefined();
  });

  it("lanza si falta la API key (servicio no configurado)", async () => {
    await expect(
      sendEmail(
        { RESEND_API_KEY: undefined, RESEND_FROM: CONFIG.RESEND_FROM },
        { to: "user@example.com", subject: "x", html: "<p>x</p>" },
      ),
    ).rejects.toMatchObject({ code: "INTERNAL_ERROR", status: 500 });
  });

  it("lanza si falta el remitente", async () => {
    await expect(
      sendEmail(
        { RESEND_API_KEY: CONFIG.RESEND_API_KEY, RESEND_FROM: undefined },
        { to: "user@example.com", subject: "x", html: "<p>x</p>" },
      ),
    ).rejects.toMatchObject({ code: "INTERNAL_ERROR", status: 500 });
  });

  it("lanza VALIDATION_ERROR si no hay cuerpo html ni text", async () => {
    await expect(sendEmail(CONFIG, { to: "user@example.com", subject: "x" })).rejects.toMatchObject(
      { code: "VALIDATION_ERROR", status: 400 },
    );
  });

  it("ante un error de Resend (no 2xx) guarda el motivo en cause, no en el mensaje al cliente", async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse({ message: "domain not verified" }, 422),
    ) as unknown as typeof fetch;

    const err = (await sendEmail(CONFIG, {
      to: "user@example.com",
      subject: "x",
      html: "<p>x</p>",
    }).catch((e) => e)) as AppError;

    expect(err.code).toBe("INTERNAL_ERROR");
    expect(err.message).not.toContain("domain not verified");
    expect(String(err.cause)).toContain("domain not verified");
  });

  it("lanza si la conexión con Resend falla y conserva el error original en cause", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    const err = (await sendEmail(CONFIG, {
      to: "user@example.com",
      subject: "x",
      html: "<p>x</p>",
    }).catch((e) => e)) as AppError;

    expect(err.code).toBe("INTERNAL_ERROR");
    expect(String((err.cause as Error)?.message)).toContain("network down");
  });

  it("lanza si Resend responde 2xx pero sin id", async () => {
    globalThis.fetch = mock(async () => jsonResponse({})) as unknown as typeof fetch;

    await expect(
      sendEmail(CONFIG, { to: "user@example.com", subject: "x", html: "<p>x</p>" }),
    ).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
  });
});
