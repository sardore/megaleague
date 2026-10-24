import { registerCharacterArt } from "../char-art.js";

/* 제트스키: 왼쪽 아래로 질주하는 물방울 모양 선체, 크레센트 림, 조종창, 뒤로 휘날리는 지느러미와 물보라.
   원본 스케치의 좌표(약 1404×1053)를 그대로 쓰고, 번진 연필 선은 한 겹의 깔끔한 윤곽선으로 정리했다. */
const INK = "#1d2447";
const LINE = `stroke="${INK}" stroke-width="15" stroke-linejoin="round" stroke-linecap="round"`;
const THIN = `stroke="${INK}" stroke-width="9" stroke-linejoin="round" stroke-linecap="round"`;

const defs = `
<linearGradient id="{id}-hull" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="#e6eefb"/><stop offset="1" stop-color="#b8cdee"/></linearGradient>
<linearGradient id="{id}-rim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5aa0f2"/><stop offset=".6" stop-color="#7d7be0"/><stop offset="1" stop-color="#9a64d6"/></linearGradient>
<linearGradient id="{id}-fin" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f4f9ff"/><stop offset="1" stop-color="#a9c6f4"/></linearGradient>
<linearGradient id="{id}-glass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2b3f86"/><stop offset="1" stop-color="#4f7fe0"/></linearGradient>
<linearGradient id="{id}-streak" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#3f8ae8" stop-opacity=".9"/><stop offset=".6" stop-color="#7f86e6" stop-opacity=".55"/><stop offset="1" stop-color="#b79cf0" stop-opacity="0"/></linearGradient>
<linearGradient id="{id}-spray" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#b9c7e0" stop-opacity=".95"/><stop offset="1" stop-color="#b9c7e0" stop-opacity="0"/></linearGradient>`;

/* 뒤로 흐르는 물보라 선(바깥 배경 효과) */
const streaks = `
<g class="rig rig-flow">
  <path d="M120 560 C380 330 640 150 930 52 L960 120 C700 220 430 380 190 620 Z" fill="url(#{id}-streak)"/>
  <path d="M170 980 C420 940 700 930 1010 872 L1020 912 C720 980 420 1000 190 1006 Z" fill="url(#{id}-streak)"/>
  <path d="M1000 470 C1060 450 1130 420 1190 380 L1196 416 C1130 456 1070 490 1010 510 Z" fill="url(#{id}-streak)" opacity=".7"/>
  <path d="M1020 730 C1080 706 1140 688 1196 664 L1200 696 C1140 724 1080 748 1030 760 Z" fill="url(#{id}-streak)" opacity=".7"/>
</g>`;

/* 선체 뒤의 들쭉날쭉한 물보라 */
const wake = `
<g class="rig rig-wake">
  <path d="M740 540 L840 430 L800 520 L960 470 L770 590 L700 610 Z" fill="url(#{id}-spray)" ${THIN}/>
  <path d="M640 690 L880 648 L740 700 L860 690 L660 780 Z" fill="url(#{id}-spray)" ${THIN}/>
</g>`;

const finBig = `
<g class="rig rig-fin rig-fin-a">
  <path d="M800 150 C760 232 700 300 690 384 C682 436 692 470 728 466 L766 524 L596 526 L600 312 C690 262 750 206 800 150 Z" fill="url(#{id}-fin)" ${LINE}/>
</g>`;
const finSmall = `
<g class="rig rig-fin rig-fin-b">
  <path d="M592 312 C556 352 516 410 506 498 C548 444 574 404 606 372 Z" fill="url(#{id}-fin)" ${THIN}/>
</g>`;

const body = `
<path d="M600 312 C450 372 302 474 276 640 C262 762 332 842 442 860 C522 870 594 832 644 790 C706 728 744 648 764 556 C720 520 650 524 560 522 Z" fill="url(#{id}-hull)" ${LINE}/>
<path d="M330 520 C272 604 256 704 288 784 C332 852 442 884 564 832 L522 808 C444 830 372 812 332 762 C306 702 310 612 362 542 Z" fill="url(#{id}-rim)" ${THIN}/>
<path d="M404 468 C452 424 520 384 590 350" fill="none" stroke="#fff" stroke-width="12" stroke-linecap="round" opacity=".8"/>
<path d="M372 540 C320 590 304 650 322 720" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round" opacity=".55"/>`;

const cockpit = `
<g class="rig rig-cockpit">
  <path d="M328 664 C334 630 402 612 452 618 C480 626 474 684 452 714 C420 744 350 742 326 702 Z" fill="url(#{id}-glass)" ${LINE}/>
  <path class="rig rig-pulse" d="M386 650 L408 674 L386 708 L362 682 Z" fill="#fff" opacity=".7"/>
  <path d="M330 742 L430 690 M342 768 L470 702 M402 792 L486 722" fill="none" ${THIN}/>
</g>`;

registerCharacterArt("jetski", {
  viewBox: "130 40 1100 920",
  defs,
  body: `${streaks}<g class="rig rig-float">${wake}${finBig}${body}${finSmall}${cockpit}</g>`
});
