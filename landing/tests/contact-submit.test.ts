// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { setupContactForm } from "../src/contact/submitContactForm";

const COPY = {
  sending: "Sending",
  success: "Received",
  validationError: "Check the fields",
  throttled: "Try later",
  unavailable: "Unavailable",
  serviceError: "Service unavailable",
  genericError: "Could not send",
  networkError: "Connection failed",
};

function mountForm(endpoint: string | undefined = "https://api.example.test/custom/public/contact") {
  document.body.innerHTML = `
    <form data-contact-form novalidate>
      <label for="name">Name</label><input id="name" name="name" required minlength="4" maxlength="120">
      <label for="email">Email</label><input id="email" name="email" type="email" required>
      <label for="message">Message</label><textarea id="message" name="message" required minlength="10" maxlength="2000"></textarea>
      <input name="website" tabindex="-1" aria-hidden="true">
      <button type="submit" disabled>Send</button>
      <p data-contact-status role="status" aria-live="polite"></p>
    </form>`;

  const form = document.querySelector<HTMLFormElement>("form")!;
  const cleanup = setupContactForm(form, endpoint, COPY);
  return {
    form,
    button: form.querySelector<HTMLButtonElement>("button")!,
    status: form.querySelector<HTMLElement>("[data-contact-status]")!,
    cleanup,
  };
}

function fillValid(form: HTMLFormElement) {
  (form.elements.namedItem("name") as HTMLInputElement).value = "  Ada Lovelace  ";
  (form.elements.namedItem("email") as HTMLInputElement).value = "  ada@example.test  ";
  (form.elements.namedItem("message") as HTMLTextAreaElement).value = "  A useful synthetic message.  ";
}

function submit(form: HTMLFormElement) {
  form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("contact form submission controller", () => {
  it("binds the real DOM form and sends trimmed JSON only after a valid user submission", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    const { form, status } = mountForm();
    fillValid(form);

    expect(fetchMock).not.toHaveBeenCalled();
    submit(form);
    await vi.waitFor(() => expect(status.textContent).toBe(COPY.success));

    expect(fetchMock).toHaveBeenCalledWith("https://api.example.test/custom/public/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "omit",
      body: JSON.stringify({
        name: "Ada Lovelace",
        email: "ada@example.test",
        message: "A useful synthetic message.",
        website: "",
      }),
    });
    expect((form.elements.namedItem("name") as HTMLInputElement).value).toBe("");
  });

  it.each([
    ["name", " abc ", COPY.validationError],
    ["email", "not-an-email", COPY.validationError],
    ["message", " short ", COPY.validationError],
  ])("enforces native and post-trim validation for %s", async (field, value, expected) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { form, status } = mountForm();
    fillValid(form);
    (form.elements.namedItem(field) as HTMLInputElement | HTMLTextAreaElement).value = value;

    submit(form);
    await Promise.resolve();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(status.textContent).toBe(expected);
  });

  it.each([
    [200, COPY.genericError],
    [422, COPY.validationError],
    [429, COPY.throttled],
    [503, COPY.serviceError],
    [500, COPY.genericError],
  ])("treats HTTP %s without trusting the response body", async (statusCode, expected) => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("<script>untrusted backend text</script>", { status: statusCode }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { form, status } = mountForm();
    fillValid(form);

    submit(form);
    await vi.waitFor(() => expect(status.textContent).toBe(expected));

    expect((form.elements.namedItem("name") as HTMLInputElement).value).toContain("Ada");
    expect(status.textContent).not.toContain("untrusted");
  });

  it("preserves input on network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("synthetic offline")));
    const { form, status } = mountForm();
    fillValid(form);

    submit(form);
    await vi.waitFor(() => expect(status.textContent).toBe(COPY.networkError));

    expect((form.elements.namedItem("message") as HTMLTextAreaElement).value).toContain("synthetic");
  });

  it("disables while pending, exposes aria-busy, and guards duplicate submissions", async () => {
    let resolveFetch!: (response: Response) => void;
    const fetchMock = vi.fn().mockReturnValue(new Promise<Response>((resolve) => { resolveFetch = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    const { form, button, status } = mountForm();
    fillValid(form);

    submit(form);
    submit(form);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(true);
    expect(form.getAttribute("aria-busy")).toBe("true");
    expect(status.textContent).toBe(COPY.sending);

    resolveFetch(new Response(null, { status: 503 }));
    await vi.waitFor(() => expect(button.disabled).toBe(false));
    expect(form.hasAttribute("aria-busy")).toBe(false);
  });

  it("keeps the form disabled and never fetches when API configuration is unavailable", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { form, button, status } = mountForm("");
    fillValid(form);

    submit(form);

    expect(button.disabled).toBe(true);
    expect(status.textContent).toBe(COPY.unavailable);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
