export interface ContactFormCopy {
  sending: string;
  success: string;
  validationError: string;
  throttled: string;
  unavailable: string;
  serviceError: string;
  genericError: string;
  networkError: string;
}

interface ContactPayload {
  name: string;
  email: string;
  message: string;
  website: string;
}

function getControl<T extends HTMLInputElement | HTMLTextAreaElement>(
  form: HTMLFormElement,
  name: string,
): T | undefined {
  const control = form.elements.namedItem(name);
  return control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement
    ? control as T
    : undefined;
}

function readValidPayload(form: HTMLFormElement): ContactPayload | undefined {
  const nameControl = getControl<HTMLInputElement>(form, "name");
  const emailControl = getControl<HTMLInputElement>(form, "email");
  const messageControl = getControl<HTMLTextAreaElement>(form, "message");
  const websiteControl = getControl<HTMLInputElement>(form, "website");
  if (!nameControl || !emailControl || !messageControl || !websiteControl) return undefined;

  const payload = {
    name: nameControl.value.trim(),
    email: emailControl.value.trim(),
    message: messageControl.value.trim(),
    website: websiteControl.value.trim(),
  };
  const emailValidator = document.createElement("input");
  emailValidator.type = "email";
  emailValidator.required = true;
  emailValidator.value = payload.email;

  if (
    payload.name.length < 4 || payload.name.length > 120 ||
    !emailValidator.checkValidity() ||
    payload.message.length < 10 || payload.message.length > 2000
  ) {
    form.reportValidity();
    return undefined;
  }
  return payload;
}

export function setupContactForm(
  form: HTMLFormElement,
  endpoint: string | undefined,
  copy: ContactFormCopy,
): () => void {
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  const status = form.querySelector<HTMLElement>("[data-contact-status]");
  if (!button || !status) return () => undefined;

  if (!endpoint) {
    button.disabled = true;
    status.textContent = copy.unavailable;
    return () => undefined;
  }

  button.disabled = false;
  let pending = false;

  const onSubmit = async (event: SubmitEvent) => {
    event.preventDefault();
    if (pending) return;

    const payload = readValidPayload(form);
    if (!payload) {
      status.textContent = copy.validationError;
      return;
    }

    pending = true;
    button.disabled = true;
    form.setAttribute("aria-busy", "true");
    status.textContent = copy.sending;

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "omit",
        body: JSON.stringify(payload),
      });

      if (response.status === 202) {
        form.reset();
        status.textContent = copy.success;
      } else if (response.status === 422) {
        status.textContent = copy.validationError;
      } else if (response.status === 429) {
        status.textContent = copy.throttled;
      } else if (response.status === 503) {
        status.textContent = copy.serviceError;
      } else {
        status.textContent = copy.genericError;
      }
    } catch {
      status.textContent = copy.networkError;
    } finally {
      pending = false;
      button.disabled = false;
      form.removeAttribute("aria-busy");
    }
  };

  form.addEventListener("submit", onSubmit);
  return () => form.removeEventListener("submit", onSubmit);
}
