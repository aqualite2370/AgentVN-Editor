import { nanoid } from "nanoid";

export function newId(prefix: string): string {
  return `${prefix}_${nanoid(10)}`;
}
