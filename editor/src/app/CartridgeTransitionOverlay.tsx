type CartridgeTransitionIntent = "enter-cartridge" | "exit-cartridge";

export function CartridgeTransitionOverlay({ intent }: { intent: CartridgeTransitionIntent }) {
  const isEjecting = intent === "exit-cartridge";
  const label = isEjecting ? "弹出 VN 卡带" : "启动 VN 卡带";
  const status = isEjecting ? "返回项目库" : "正在连接容器";

  return (
    <div className={`cartridge-boot-overlay${isEjecting ? " is-ejecting" : " is-booting"}`} aria-hidden="true">
      <svg className="slot-svg" viewBox="0 0 960 540" role="img">
        <defs>
          <linearGradient id="slotMetal" x1="190" y1="210" x2="770" y2="360" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="color-mix(in srgb, var(--line-strong) 38%, var(--bg))" />
            <stop offset="0.5" stopColor="color-mix(in srgb, var(--surface-2) 82%, var(--bg))" />
            <stop offset="1" stopColor="color-mix(in srgb, var(--line-strong) 48%, var(--bg))" />
          </linearGradient>
        </defs>

        <rect className="cart-stage-vignette" x="0" y="0" width="960" height="540" rx="0" />

        <g className="slot-assembly">
          <ellipse className="slot-shadow" cx="480" cy="392" rx="268" ry="34" />
          <path className="slot-frame" d="M188 243h584l42 48-42 48H188l-42-48z" />
          <path className="slot-mouth" d="M226 266h508l22 25-22 25H226l-22-25z" />
          <g className="slot-rails">
            <path d="M238 272h456" />
            <path d="M238 310h456" />
            <path d="M284 252l-48 38 48 38" />
            <path d="M676 252l48 38-48 38" />
          </g>
          <g className="slot-locks">
            <path className="slot-lock slot-lock-left" d="M178 238h52l18 20v66l-18 20h-52z" />
            <path className="slot-lock slot-lock-right" d="M730 238h52l-18 20v66l18 20h-52z" />
            <circle cx="216" cy="291" r="8" />
            <circle cx="744" cy="291" r="8" />
          </g>
          <g className="slot-indicators">
            <rect x="360" y="236" width="36" height="5" rx="2.5" />
            <rect x="414" y="236" width="132" height="5" rx="2.5" />
            <rect x="564" y="236" width="36" height="5" rx="2.5" />
          </g>
          <path className="slot-shutter" d="M244 278h472l12 13-12 13H244l-12-13z" />
        </g>

        <g className="cart-status-panel">
          <rect x="346" y="462" width="268" height="30" rx="15" />
          <text x="480" y="482">{status}</text>
        </g>
      </svg>

      <div className="cart-motion-layer">
        <svg className="cart-svg" viewBox="0 0 960 540" role="img">
          <defs>
            <linearGradient id="cartShell" x1="120" y1="110" x2="760" y2="450" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="var(--surface-3)" />
              <stop offset="0.46" stopColor="var(--surface)" />
              <stop offset="1" stopColor="var(--bg-elevated)" />
            </linearGradient>
            <linearGradient id="cartLabel" x1="240" y1="145" x2="650" y2="300" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="color-mix(in srgb, var(--warning) 72%, white)" />
              <stop offset="0.52" stopColor="color-mix(in srgb, var(--accent-2) 40%, var(--surface-2))" />
              <stop offset="1" stopColor="color-mix(in srgb, var(--accent) 58%, var(--surface))" />
            </linearGradient>
            <linearGradient id="pinGold" x1="300" y1="360" x2="650" y2="394" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#7b5220" />
              <stop offset="0.28" stopColor="#f1c46b" />
              <stop offset="0.6" stopColor="#9f6b2c" />
              <stop offset="1" stopColor="#ffe39a" />
            </linearGradient>
            <clipPath id="cartTopCut">
              <path d="M232 122h496l40 46v292H192V168z" />
            </clipPath>
          </defs>

          <g className="cart-flight">
            <g className="cart-lock">
              <ellipse className="cart-static-shadow" cx="480" cy="438" rx="286" ry="38" />
              <g className="cart-assembly">
                <path className="cart-body" d="M232 122h496l40 46v292H192V168z" />
                <path className="cart-bevel" d="M232 122h496l40 46H192z" />
                <path className="cart-bottom-lip" d="M214 374h532v62H214z" />
                <g className="cart-grooves" clipPath="url(#cartTopCut)">
                  <path d="M222 188h516" />
                  <path d="M222 214h516" />
                  <path d="M250 122v82" />
                  <path d="M710 122v82" />
                </g>
                <g className="cart-screws">
                  <circle cx="236" cy="170" r="14" />
                  <circle cx="724" cy="170" r="14" />
                  <circle cx="236" cy="418" r="14" />
                  <circle cx="724" cy="418" r="14" />
                  <path d="M228 170h16M236 162v16M716 170h16M724 162v16M228 418h16M236 410v16M716 418h16M724 410v16" />
                </g>
                <g className="cart-label">
                  <rect x="282" y="152" width="396" height="170" rx="12" />
                  <path d="M310 180h186M310 210h296M310 240h238" />
                  <path className="cart-arrow" d="M610 242l36 20-36 20v-14h-58v-12h58z" />
                  <text x="310" y="292">{label}</text>
                </g>
                <g className="cart-window">
                  <rect x="214" y="250" width="46" height="72" rx="8" />
                  <path d="M226 266h22M226 284h22M226 302h22" />
                </g>
                <g className="cart-pins">
                  {Array.from({ length: 12 }).map((_, index) => (
                    <rect key={index} x={302 + index * 30} y="384" width="18" height="44" rx="3" />
                  ))}
                </g>
                <path className="cart-highlight" d="M222 150h480c18 0 30 12 36 24" />
                <path className="cart-edge-shine" d="M744 174v248" />
              </g>
            </g>
          </g>
        </svg>
      </div>
    </div>
  );
}
