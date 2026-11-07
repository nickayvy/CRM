import { describe, expect, it } from "vitest";
import { TEMPLATE_TOKENS, type TemplateBusiness, renderTemplate } from "@/lib/email/template";

function biz(overrides: Partial<TemplateBusiness> = {}): TemplateBusiness {
  return {
    name: "Bayou Plumbing",
    ownerName: "Maria Elena Lopez",
    city: "Houston",
    state: "TX",
    primaryCategory: "plumbing",
    rating: "4.5",
    reviewCount: 42,
    displayPhone: "(713) 555-0123",
    phone: "+17135550123",
    ...overrides,
  };
}

describe("renderTemplate tokens", () => {
  it.each([
    ["business_name", "Bayou Plumbing"],
    ["owner_first_name", "Maria"],
    ["owner_name", "Maria Elena Lopez"],
    ["city", "Houston"],
    ["state", "TX"],
    ["category", "plumbing"],
    ["rating", "4.5"],
    ["review_count", "42"],
    ["phone", "(713) 555-0123"],
  ])("replaces {{%s}}", (token, expected) => {
    expect(renderTemplate(`[{{${token}}}]`, biz())).toBe(`[${expected}]`);
  });

  it("renders every documented token to a non-empty value for a fully populated business", () => {
    expect(TEMPLATE_TOKENS.map((t) => t.token)).toEqual([
      "business_name",
      "owner_first_name",
      "owner_name",
      "city",
      "state",
      "category",
      "rating",
      "review_count",
      "phone",
    ]);
    for (const { token } of TEMPLATE_TOKENS) {
      expect(renderTemplate(`{{${token}}}`, biz()), token).not.toBe("");
    }
  });

  it("replaces several different tokens in one template", () => {
    expect(renderTemplate("Hi {{owner_first_name}}, {{business_name}} in {{city}}, {{state}}.", biz())).toBe(
      "Hi Maria, Bayou Plumbing in Houston, TX.",
    );
  });

  it("replaces every occurrence of a repeated token", () => {
    expect(renderTemplate("{{city}} / {{city}} / {{ city }}", biz())).toBe("Houston / Houston / Houston");
  });

  it("allows whitespace inside the braces", () => {
    expect(renderTemplate("{{ city }}|{{city }}|{{ city}}|{{\t city \n}}", biz())).toBe("Houston|Houston|Houston|Houston");
  });

  it("leaves text without tokens unchanged", () => {
    const text = "No tokens here. {single} {{ }} {{}} } {";
    expect(renderTemplate(text, biz())).toBe(text);
    expect(renderTemplate("", biz())).toBe("");
  });
});

describe("renderTemplate owner names", () => {
  it("uses the first word of ownerName for owner_first_name", () => {
    expect(renderTemplate("{{owner_first_name}}", biz({ ownerName: "  Maria   Lopez " }))).toBe("Maria");
    expect(renderTemplate("{{owner_first_name}}", biz({ ownerName: "Cher" }))).toBe("Cher");
  });

  it("renders owner_first_name and owner_name as '' for null or blank owners", () => {
    for (const ownerName of [null, "", "   "]) {
      expect(renderTemplate("[{{owner_first_name}}][{{owner_name}}]", biz({ ownerName }))).toBe("[][]");
    }
  });
});

describe("renderTemplate unknown and missing values", () => {
  it("renders unknown tokens as ''", () => {
    expect(renderTemplate("a{{foo}}b", biz())).toBe("ab");
    expect(renderTemplate("a{{ constructor }}b", biz())).toBe("ab");
    expect(renderTemplate("a{{__proto__}}b", biz())).toBe("ab");
    expect(renderTemplate("a{{toString}}b{{hasOwnProperty}}c", biz())).toBe("abc");
    // Token names are case-sensitive.
    expect(renderTemplate("a{{CITY}}b", biz())).toBe("ab");
  });

  it("renders null city, state, category and rating as ''", () => {
    const b = biz({ city: null, state: null, primaryCategory: null, rating: null });
    expect(renderTemplate("[{{city}}][{{state}}][{{category}}][{{rating}}]", b)).toBe("[][][][]");
  });

  it("renders the review count as a number string, including 0", () => {
    expect(renderTemplate("{{review_count}}", biz({ reviewCount: 0 }))).toBe("0");
  });
});

describe("renderTemplate phone", () => {
  it("prefers displayPhone", () => {
    expect(renderTemplate("{{phone}}", biz({ displayPhone: "713-555-9999", phone: "+17135550123" }))).toBe("713-555-9999");
  });

  it("falls back to the formatted phone when displayPhone is null", () => {
    expect(renderTemplate("{{phone}}", biz({ displayPhone: null, phone: "+17135550123" }))).toBe("(713) 555-0123");
  });

  it("renders '' when there is no phone at all", () => {
    expect(renderTemplate("[{{phone}}]", biz({ displayPhone: null, phone: null }))).toBe("[]");
  });
});
