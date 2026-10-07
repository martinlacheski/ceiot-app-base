/** File size in megabytes with a decimal comma ("2,1 MB"), as the app shows sizes. */
export const formatFileSize = (bytes: number) =>
  `${(bytes / 1_000_000).toFixed(1).replace(".", ",")} MB`;
