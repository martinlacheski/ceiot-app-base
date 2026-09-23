export const REPORT_BRAND_TAGLINE = "Monitoreo Ambiental IoT";

export interface ReportImage {
  data: string;
  width: number;
  height: number;
}

interface ReportBranding {
  logo: ReportImage;
  right: ReportImage;
}

let cachedBranding: Promise<ReportBranding> | undefined;

function prepareImage(filename: string): Promise<ReportImage> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timeout = window.setTimeout(() => fail(), 15000);
    const cleanup = () => {
      window.clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
    };
    const fail = () => {
      cleanup();
      reject(new Error(`No se pudo cargar la imagen del reporte: ${filename}`));
    };

    image.onerror = fail;
    image.onload = () => {
      cleanup();
      try {
        const width = image.naturalWidth;
        const height = image.naturalHeight;
        if (!width || !height) throw new Error("La imagen del reporte está vacía");
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("No se pudo preparar la imagen del reporte");
        context.drawImage(image, 0, 0);
        resolve({ data: canvas.toDataURL("image/png"), width, height });
      } catch (error) {
        reject(error);
      }
    };
    image.src = `${import.meta.env.BASE_URL}${filename}`;
  });
}

export function loadReportBranding(): Promise<ReportBranding> {
  cachedBranding ??= Promise.all([
    prepareImage("report/report-logo-left.png"),
    prepareImage("report/report-logo-right.png"),
  ]).then(([logo, right]) => ({ logo, right })).catch((error: unknown) => {
    cachedBranding = undefined;
    throw error;
  });
  return cachedBranding;
}
