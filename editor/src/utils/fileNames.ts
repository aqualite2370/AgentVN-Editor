function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

export function sanitizeFileNamePart(value: string): string {
  const cleaned = value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^\.+|\.+$/g, "");

  return cleaned || "未命名项目";
}

export function formatLocalDateTimeForFile(date = new Date()): string {
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hour = pad(date.getHours());
  const minute = pad(date.getMinutes());
  const second = pad(date.getSeconds());

  return `${year}${month}${day}_${hour}${minute}${second}`;
}

export function buildProjectExportFileName(projectTitle: string, date = new Date()): string {
  return `${sanitizeFileNamePart(projectTitle)}_${formatLocalDateTimeForFile(date)}.vnproj`;
}

export function buildRuntimeScriptFileName(projectTitle: string, date = new Date()): string {
  return `${sanitizeFileNamePart(projectTitle)}_${formatLocalDateTimeForFile(date)}_script.json`;
}
