import { registerCharacterArt } from "../char-art.js";

/* 제트스키: 왼쪽 아래로 질주하는 물방울 선체, 크레센트 림, 조종창, 뒤로 휘날리는 지느러미와 물보라. 원본 스케치 좌표(약 1404×1053)를 따라 한 겹의 윤곽선으로 다시 그렸다.
   부품(rig-*)은 뒤→앞 순서로 그룹지어 CSS가 움직인다. */
const defs = `
<linearGradient id="{id}-streak" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#4fa8ff" stop-opacity="0"/><stop offset=".25" stop-color="#4fa8ff" stop-opacity=".85"/><stop offset=".7" stop-color="#8a74ff" stop-opacity=".7"/><stop offset="1" stop-color="#b08cff" stop-opacity="0"/></linearGradient>
<linearGradient id="{id}-streak2" x1="1" y1="0" x2="0" y2="0"><stop offset="0" stop-color="#6aa8ff" stop-opacity="0"/><stop offset=".4" stop-color="#7a8cff" stop-opacity=".75"/><stop offset="1" stop-color="#5fb4ff" stop-opacity=".9"/></linearGradient>
<linearGradient id="{id}-spray" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#8d98b3"/><stop offset="1" stop-color="#dfe6f5" stop-opacity=".55"/></linearGradient>
<linearGradient id="{id}-rim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5fb8ff"/><stop offset=".55" stop-color="#6a7cff"/><stop offset="1" stop-color="#9a5cf0"/></linearGradient>
<linearGradient id="{id}-hull" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="#e3ecff"/><stop offset="1" stop-color="#b9c8f2"/></linearGradient>
<linearGradient id="{id}-fin" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#7fc4ff"/><stop offset=".6" stop-color="#bfe0ff"/><stop offset="1" stop-color="#f2f8ff"/></linearGradient>
<linearGradient id="{id}-glass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#29356b"/><stop offset=".6" stop-color="#2a5fb4"/><stop offset="1" stop-color="#58b8ff"/></linearGradient>
<linearGradient id="{id}-finA" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d7ecff"/><stop offset="1" stop-color="#6fb4f2"/></linearGradient>
`;

const body = `
<g class="rig rig-flow">
  <path d="M30 520 C190 380 520 210 900 100 C540 250 250 430 60 548 Z" fill="url(#{id}-streak)"/>
  <path d="M150 978 C400 932 700 912 1010 872 C760 952 450 968 160 992 Z" fill="url(#{id}-streak)"/>
  <path d="M960 470 C1080 420 1230 400 1400 410 C1250 442 1100 472 970 506 Z" fill="url(#{id}-streak2)"/>
  <path d="M900 250 C1010 202 1130 172 1262 190 C1150 222 1040 252 930 286 Z" fill="url(#{id}-streak2)"/>
  <path d="M1000 652 C1100 640 1250 650 1382 692 C1260 702 1120 692 1010 692 Z" fill="url(#{id}-streak2)"/>
</g>
<g class="rig rig-wake">
  <path d="M680 480 L786 432 L748 502 L1006 414 L792 574 L882 650 L730 672 L776 656 L700 640 L640 760 L520 846 L560 700 Z" fill="url(#{id}-spray)" stroke="#2c3350" stroke-width="12" stroke-linejoin="round"/>
</g>
<g class="rig rig-fin-b">
  <path d="M800 150 C740 232 640 292 580 330 L690 470 C676 420 680 380 700 330 C730 270 770 210 800 150 Z" fill="url(#{id}-fin)" stroke="#1b2340" stroke-width="14" stroke-linejoin="round"/>
</g>
<path d="M272 640 C266 520 340 440 470 372 C540 336 590 312 600 304 L700 470 C640 510 560 520 480 530 C400 540 350 560 320 610 Z" fill="url(#{id}-fin)" stroke="#1b2340" stroke-width="14" stroke-linejoin="round"/>
<path d="M272 640 C266 780 330 850 430 862 C520 862 600 822 660 780 C600 760 540 700 480 640 C430 580 380 560 340 560 C300 560 274 600 272 640 Z" fill="url(#{id}-rim)" stroke="#1b2340" stroke-width="14" stroke-linejoin="round"/>
<path d="M332 590 C380 540 470 530 600 504 C660 492 700 480 704 470 C760 560 760 620 700 690 C640 760 560 810 430 818 C360 818 322 770 314 700 C310 650 316 612 332 590 Z" fill="url(#{id}-hull)" stroke="#1b2340" stroke-width="14" stroke-linejoin="round"/>
<g class="rig rig-fin-a">
  <path d="M598 318 C556 372 492 434 462 502 L470 524 C510 488 560 450 612 404 Z" fill="url(#{id}-finA)" stroke="#1b2340" stroke-width="14" stroke-linejoin="round"/>
</g>
<path d="M560 700 C640 680 690 620 700 520 C720 580 700 660 640 730 C600 770 540 800 470 812 C510 780 540 740 560 700 Z" fill="#8aa0e0" opacity=".28"/>
<g class="rig rig-glass">
  <path d="M332 662 C346 640 400 610 440 606 C466 606 474 626 468 648 C458 690 420 722 372 746 C344 756 328 740 332 718 Z" fill="url(#{id}-glass)" stroke="#1b2340" stroke-width="14" stroke-linejoin="round"/>
  <path class="rig rig-pulse" d="M386 648 L410 668 L384 716 L358 694 Z" fill="#cfeaff" stroke="#fff" stroke-width="6" stroke-linejoin="round" opacity=".9"/>
  <path d="M350 676 C380 640 430 622 456 622" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" opacity=".5"/>
</g>
<path d="M338 756 C390 740 440 716 478 690 M360 790 C420 770 460 748 490 716" fill="none" stroke="#1b2340" stroke-width="12" stroke-linecap="round"/>
<path d="M360 460 C320 510 296 580 296 650 M470 380 C420 410 380 440 350 470" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round" opacity=".55"/>
`;

registerCharacterArt("jetski", {
  viewBox: "130 60 1280 1000",
  defs,
  body: `<g class="rig rig-float">${body}</g>`
});
