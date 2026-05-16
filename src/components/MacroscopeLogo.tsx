interface MacroscopeLogoProps {
  size?: number;
}

export default function MacroscopeLogo({ size = 20 }: MacroscopeLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 1024 1024"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect width="1024" height="1024" rx="230" ry="230" fill="#1a1a26" />
      <g transform="translate(512, 512)">
        <path
          d="M -320 224 L -320 -224 L -102 83 L 102 -70 L 320 -224 L 320 224 L 230 224 L 230 -102 L 102 45 L -102 -45 L -230 -102 L -230 224 Z"
          fill="rgba(255,255,255,0.96)"
        />
        <rect x="-320" y="154" width="640" height="70" fill="#f5a623" />
      </g>
    </svg>
  );
}
