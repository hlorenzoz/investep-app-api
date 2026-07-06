import { describe, expect, it } from "bun:test";
import { validateSeedBrokers } from "../scripts/populate-brokers-schema";

const BROKER = {
  slug: "interactive-brokers",
  name: "Interactive Brokers",
  url: "https://www.interactivebrokers.com/",
};

describe("validateSeedBrokers · campos requeridos", () => {
  it("acepta un bróker mínimo válido (slug, name, url)", () => {
    expect(() => validateSeedBrokers([{ ...BROKER }])).not.toThrow();
  });

  it("acepta logo/favicon/icon y url_secondary opcionales", () => {
    const entries = [
      {
        ...BROKER,
        url_secondary: "https://www.interactivebrokers.ie/",
        logo: "brokers/interactive-brokers-logo.svg",
        favicon: "brokers/interactive-brokers-icon-128x128.png",
        icon: "brokers/interactive-brokers-icon-128x128.png",
      },
    ];
    expect(() => validateSeedBrokers(entries)).not.toThrow();
  });

  it("rechaza sin name, identificando el slug ofensor", () => {
    const entries = [{ slug: "interactive-brokers", url: "https://x.com/" }];
    expect(() => validateSeedBrokers(entries)).toThrow(/interactive-brokers/);
  });

  it("rechaza un slug con mayúsculas, identificando el slug ofensor", () => {
    const entries = [{ ...BROKER, slug: "Bad-Slug" }];
    expect(() => validateSeedBrokers(entries)).toThrow(/Bad-Slug/);
  });
});

describe("validateSeedBrokers · URL http(s)", () => {
  it("rechaza una url no-http (ftp://), identificando el slug ofensor", () => {
    const entries = [{ ...BROKER, url: "ftp://example.com/x" }];
    expect(() => validateSeedBrokers(entries)).toThrow(/interactive-brokers/);
  });

  it("rechaza una url que no es URL válida", () => {
    const entries = [{ ...BROKER, url: "no-es-una-url" }];
    expect(() => validateSeedBrokers(entries)).toThrow(/interactive-brokers/);
  });

  it("acepta url_secondary null", () => {
    expect(() => validateSeedBrokers([{ ...BROKER, url_secondary: null }])).not.toThrow();
  });

  it("rechaza url_secondary no-http (ftp://), identificando el slug ofensor", () => {
    const entries = [{ ...BROKER, url_secondary: "ftp://example.com/x" }];
    expect(() => validateSeedBrokers(entries)).toThrow(/interactive-brokers/);
  });
});

describe("validateSeedBrokers · manifiesto real", () => {
  it("el archivo scripts/data/brokers.json completo es válido", async () => {
    const data = (await import("../scripts/data/brokers.json")) as unknown as {
      default: unknown[];
    };
    const entries = Array.isArray(data) ? data : data.default;
    const result = validateSeedBrokers(entries as unknown[]);
    expect(result.length).toBe(3);
  });
});
