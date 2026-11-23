const androidIdPattern = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*){2,}$/;

export function windowsReleasePathIssue(gameId: string): string | undefined {
  const stem = gameId.split(".")[0];
  if (gameId.endsWith(".") || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem)) {
    return "游戏编号不能作为 Windows 存档目录名。请移除末尾的点，或避开 CON、PRN、AUX、NUL、COM1–9、LPT1–9 等保留名称。";
  }
}

export function androidApplicationIdIssue(explicitId = ""): string | undefined {
  const id = explicitId.trim();
  if (!id) {
    return "请填写 Android 包名。新版不再从游戏编号自动推算包名，以免覆盖其他作品。更新已发布作品时请填写旧 APK 的实际包名。";
  }
  if (!androidIdPattern.test(id)) {
    return "本工具的 Android 包名至少包含三段，每段以小写字母开头，只能包含小写字母和数字。不会自动改写包名。";
  }
}
