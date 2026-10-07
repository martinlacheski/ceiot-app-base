/**
 * Reads the `esp_app_desc_t` that ESP-IDF embeds in every app image (`esp_app_format.h`): it
 * follows the 24-byte image header and the first 8-byte segment header, at file offset 32.
 */

/** ESP-IDF `project(...)` name of the device firmware; the backend rejects any other image. */
export const FIRMWARE_PROJECT = "iot_device";

export const APP_DESC_MAGIC = 0xabcd5432;
/** Enough of the file head to hold the whole descriptor. */
export const APP_DESC_HEAD_BYTES = 256;

const MAGIC_OFFSET = 32;
const VERSION = { offset: 48, length: 32 };
const PROJECT = { offset: 80, length: 32 };
const TIME = { offset: 112, length: 16 };
const DATE = { offset: 128, length: 16 };
const IDF = { offset: 144, length: 32 };
const DESCRIPTOR_END = IDF.offset + IDF.length;

export interface AppDescriptor {
  version: string;
  projectName: string;
  buildTime: string;
  buildDate: string;
  idfVersion: string;
}

const readString = (
  bytes: Uint8Array,
  { offset, length }: { offset: number; length: number },
) => {
  const field = bytes.subarray(offset, offset + length);
  const end = field.indexOf(0);
  return new TextDecoder()
    .decode(end === -1 ? field : field.subarray(0, end))
    .trim();
};

/** Returns null when the buffer does not start with an app descriptor. */
export function parseAppDescriptor(buffer: ArrayBuffer): AppDescriptor | null {
  if (buffer.byteLength < DESCRIPTOR_END) return null;
  if (new DataView(buffer).getUint32(MAGIC_OFFSET, true) !== APP_DESC_MAGIC)
    return null;
  const bytes = new Uint8Array(buffer);
  return {
    version: readString(bytes, VERSION),
    projectName: readString(bytes, PROJECT),
    buildTime: readString(bytes, TIME),
    buildDate: readString(bytes, DATE),
    idfVersion: readString(bytes, IDF),
  };
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** `__DATE__` ("Oct  6 2026") and `__TIME__` ("14:32:05") as "06/10/2026 14:32". */
const formatBuildMoment = (date: string, time: string): string => {
  const match = /^([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})$/.exec(date);
  const month = match ? MONTHS.indexOf(match[1]) : -1;
  if (!match || month === -1) return `${date} ${time}`.trim();
  const day = match[2].padStart(2, "0");
  const monthText = String(month + 1).padStart(2, "0");
  return `${day}/${monthText}/${match[3]} ${time.slice(0, 5)}`;
};

/** "iot_device · compilado 06/10/2026 14:32 · IDF v5.4" */
export const describeBuild = (descriptor: AppDescriptor): string =>
  [
    descriptor.projectName,
    `compilado ${formatBuildMoment(descriptor.buildDate, descriptor.buildTime)}`,
    `IDF ${descriptor.idfVersion}`,
  ].join(" · ");

/** The first bytes of a file; `FileReader` covers runtimes without `Blob.arrayBuffer`. */
export function readFileHead(file: Blob): Promise<ArrayBuffer> {
  const head = file.slice(0, APP_DESC_HEAD_BYTES);
  if (typeof head.arrayBuffer === "function") return head.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(head);
  });
}
