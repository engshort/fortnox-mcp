import { Resend } from "resend";
import { z } from "zod";
import { hashToken } from "./product-auth.js";

export interface EmailSettings {
  apiKey: string;
  from: string;
}

export interface AccountEmails {
  welcome(email: string, ownerId: string): Promise<void>;
  passwordReset(email: string, token: string): Promise<void>;
  passwordChanged(email: string, eventId: string): Promise<void>;
}

export function emailSettings(
  env: Record<string, string | undefined>,
): EmailSettings | undefined {
  if (env.RESEND_ENABLED !== "true") return undefined;
  const apiKey = (env.RESEND_API_KEY ?? "").trim();
  const from = (env.RESEND_FROM ?? "").trim();
  if (!/^re_[A-Za-z0-9_-]+$/.test(apiKey) || !z.email().safeParse(from).success)
    throw new Error("Invalid Resend configuration");
  return { apiKey, from };
}

export function resendAccountEmails(
  settings: EmailSettings,
  origin: string,
): AccountEmails {
  // Debug output may contain provider error text. Refuse it rather than
  // allowing private reset data to be written to process logs.
  if (typeof process !== "undefined" && process.env?.RESEND_DEBUG === "true")
    throw new Error("Resend debug logging is not supported");
  const resend = new Resend(settings.apiKey, {
    baseUrl: "https://api.resend.com",
  });
  async function send(
    email: string,
    subject: string,
    text: string,
    idempotencyKey: string,
  ): Promise<void> {
    try {
      const result = await resend.emails.send(
        {
          from: settings.from,
          to: [email],
          subject,
          text,
        },
        {
          idempotencyKey,
          signal: AbortSignal.timeout(10000),
        },
      );
      if (result.error || !result.data?.id) throw new Error();
    } catch {
      // A lost answer may still mean delivery. Do not retry or expose the
      // provider's body (which could include recipient, token or API key).
      throw new Error("EMAIL_DELIVERY_UNCONFIRMED");
    }
  }
  return {
    welcome: (email, ownerId) =>
      send(
        email,
        "Välkommen till Fortnox MCP",
        [
          "Ditt konto som installationsägare för Fortnox MCP har skapats.",
          `Logga in på ${origin}/sign-in för att ansluta dina företag och AI-klienter.`,
          "Om du inte skapade kontot, kontakta installationsoperatören.",
        ].join("\n\n"),
        `owner-welcome/${ownerId}`,
      ),
    passwordReset: async (email, token) =>
      send(
        email,
        "Återställ lösenordet för Fortnox MCP",
        [
          "Du har begärt att återställa lösenordet för Fortnox MCP.",
          `Öppna ${origin}/reset-password och ange engångskoden:`,
          token,
          "Koden gäller i tio minuter och kan bara användas en gång.",
          "Om du inte begärde detta kan du ignorera mejlet. Ditt lösenord har inte ändrats.",
        ].join("\n\n"),
        `owner-reset/${await hashToken(token)}`,
      ),
    passwordChanged: (email, eventId) =>
      send(
        email,
        "Lösenordet för Fortnox MCP har ändrats",
        [
          "Ditt lösenord för Fortnox MCP har återställts. Tidigare inloggningssessioner har avslutats.",
          `Du kan logga in igen på ${origin}/sign-in.`,
          "Om du inte ändrade lösenordet, kontakta installationsoperatören omedelbart.",
        ].join("\n\n"),
        `owner-password-changed/${eventId}`,
      ),
  };
}
