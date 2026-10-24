import { registerCharacterArt } from "../char-art.js";

/* 스위트나: 하트 더듬이, 박쥐 날개, 긴 머리, 사탕 지팡이를 든 데포르메 소녀.
   원본 스케치의 좌표(약 1475×1102)를 그대로 쓰고, 잔 선은 한 겹의 깔끔한 윤곽선으로 정리했다.
   부품은 뒤→앞 순서: 웅덩이 / 날개 / 뒷머리 / 몸(다리·치마·팔·얼굴·앞머리) / 지팡이. */
const INK = "#3b2150";
const LINE = `stroke="${INK}" stroke-width="15" stroke-linejoin="round" stroke-linecap="round"`;
const THIN = `stroke="${INK}" stroke-width="9" stroke-linejoin="round" stroke-linecap="round"`;

const defs = `
<linearGradient id="{id}-hair" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd3ea"/><stop offset=".55" stop-color="#f594c9"/><stop offset="1" stop-color="#cf6bb8"/></linearGradient>
<linearGradient id="{id}-hairTop" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe9f4"/><stop offset=".7" stop-color="#ffbfe0"/><stop offset="1" stop-color="#f79fcf"/></linearGradient>
<linearGradient id="{id}-hairBack" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ee86c3"/><stop offset="1" stop-color="#a64d9e"/></linearGradient>
<linearGradient id="{id}-skin" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff3ec"/><stop offset="1" stop-color="#ffd6cc"/></linearGradient>
<linearGradient id="{id}-dress" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff8fb"/><stop offset="1" stop-color="#ffc6e0"/></linearGradient>
<linearGradient id="{id}-wing" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9a68d8"/><stop offset="1" stop-color="#4a2886"/></linearGradient>
<radialGradient id="{id}-candy" cx=".38" cy=".34" r=".8"><stop offset="0" stop-color="#ffe3f1"/><stop offset=".5" stop-color="#ff9ccb"/><stop offset="1" stop-color="#e2568f"/></radialGradient>
<linearGradient id="{id}-syrup" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff8bbd"/><stop offset="1" stop-color="#e2478a"/></linearGradient>
<radialGradient id="{id}-puddle" cx=".5" cy=".45" r=".6"><stop offset="0" stop-color="#ffd0e6" stop-opacity=".95"/><stop offset="1" stop-color="#ff7fb8" stop-opacity=".75"/></radialGradient>
<linearGradient id="{id}-shoe" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7a4592"/><stop offset="1" stop-color="#4a2660"/></linearGradient>`;

const puddle = `
<g class="rig rig-puddle">
  <ellipse class="rig rig-ripple" cx="370" cy="1002" rx="300" ry="42" fill="none" stroke="#ff9ccb" stroke-width="8" opacity=".6"/>
  <ellipse cx="370" cy="1004" rx="285" ry="38" fill="url(#{id}-puddle)" ${THIN}/>
  <ellipse cx="300" cy="996" rx="120" ry="12" fill="#fff" opacity=".35"/>
  <g class="rig rig-peek">
    <path d="M326 990 L338 934 L366 968 Q378 962 390 968 L418 934 L430 990 Q380 1008 326 990 Z" fill="#fff6fa" ${THIN}/>
    <path d="M343 952 L350 968 M413 952 L406 968" ${THIN} fill="none" opacity=".5"/>
  </g>
</g>`;

const wingLeft = `
<g class="rig rig-flap rig-flap-l">
  <path d="M575 470 C470 400 300 330 105 292 C150 340 150 390 128 430 C190 430 210 470 190 520 C170 600 120 660 78 760 C200 700 330 640 400 600 C470 560 540 520 575 470 Z" fill="url(#{id}-wing)" ${LINE}/>
  <path d="M575 470 C420 420 250 360 105 292 M575 470 C440 520 250 560 190 520 M575 470 C420 560 200 680 78 760" fill="none" stroke="#2c1658" stroke-width="9" stroke-linecap="round" opacity=".7"/>
  <path d="M170 360 C240 380 330 400 440 440" fill="none" stroke="#d2b2ff" stroke-width="6" opacity=".45" stroke-linecap="round"/>
</g>`;

const wingRight = `
<g class="rig rig-flap rig-flap-r">
  <path d="M880 470 C960 330 1100 140 1300 78 C1270 150 1290 220 1260 280 C1290 320 1290 380 1260 430 C1240 500 1260 560 1236 612 C1130 590 1020 560 940 520 C910 505 890 490 880 470 Z" fill="url(#{id}-wing)" ${LINE}/>
  <path d="M880 470 C990 330 1130 160 1300 78 M880 470 C1030 380 1180 330 1260 280 M880 470 C1030 470 1190 450 1260 430 M880 470 C1000 520 1130 560 1236 612" fill="none" stroke="#2c1658" stroke-width="9" stroke-linecap="round" opacity=".7"/>
  <path d="M960 430 C1040 330 1140 220 1240 150" fill="none" stroke="#d2b2ff" stroke-width="6" opacity=".45" stroke-linecap="round"/>
</g>`;

const hairBack = `
<g class="rig rig-sway rig-hair-r">
  <path d="M770 230 C890 235 990 380 1002 510 C1018 610 1112 650 1092 748 C1070 830 950 884 808 864 C868 826 882 786 868 742 C850 680 792 624 776 540 L760 330 Z" fill="url(#{id}-hairBack)" ${LINE}/>
  <path d="M930 420 C990 520 1030 620 1010 710 C1000 760 940 810 880 830" fill="none" stroke="#ffd3ea" stroke-width="9" stroke-linecap="round" opacity=".5"/>
</g>
<g class="rig rig-sway rig-hair-l">
  <path d="M565 250 C500 300 488 420 520 520 C540 572 578 560 592 520 L604 300 Z" fill="url(#{id}-hairBack)" ${LINE}/>
</g>`;

const legs = `
<path d="M622 700 L640 802 L670 802 L674 700 Z" fill="url(#{id}-skin)" ${THIN}/>
<path d="M702 705 L714 802 L744 802 L748 705 Z" fill="url(#{id}-skin)" ${THIN}/>
<path d="M598 800 Q600 838 640 840 Q680 838 676 806 Z" fill="url(#{id}-shoe)" ${THIN}/>
<path d="M690 806 Q692 840 722 840 Q752 838 746 810 Z" fill="url(#{id}-shoe)" ${THIN}/>`;

const dress = `
<path d="M612 500 C616 548 600 596 584 640 C572 676 568 700 586 706 L612 692 L640 710 L670 692 L700 712 L732 694 L764 712 L796 692 L832 708 L868 692 C888 650 876 614 842 590 C806 566 794 536 784 500 Z" fill="url(#{id}-dress)" ${LINE}/>
<path d="M606 632 C680 660 790 660 872 628" fill="none" stroke="#ff8fbf" stroke-width="12" stroke-linecap="round"/>
<path d="M742 512 C810 506 900 514 958 546 C966 574 940 600 916 598 C870 590 820 578 790 566 Z" fill="url(#{id}-dress)" ${LINE}/>
<path d="M800 566 C850 584 896 594 930 592" fill="none" stroke="#ff8fbf" stroke-width="11" stroke-linecap="round"/>`;

const armHold = `
<path d="M606 520 C580 540 556 560 540 578" fill="none" stroke="${INK}" stroke-width="46" stroke-linecap="round"/>
<path d="M606 520 C580 540 556 560 540 578" fill="none" stroke="#ffe0d6" stroke-width="30" stroke-linecap="round"/>
<circle cx="540" cy="580" r="28" fill="url(#{id}-skin)" ${THIN}/>`;

const head = `
<g class="rig rig-head">
  <path d="M565 330 C558 424 608 498 680 498 C752 498 792 424 786 330 C742 310 610 310 565 330 Z" fill="url(#{id}-skin)" ${LINE}/>
  <path d="M548 352 C508 240 592 138 692 140 C802 140 884 242 832 384 C802 322 762 298 700 296 C640 296 592 322 548 352 Z" fill="url(#{id}-hairTop)" ${LINE}/>
  <path d="M600 200 C640 168 700 160 760 176" fill="none" stroke="#fff" stroke-width="12" stroke-linecap="round" opacity=".7"/>
  <path d="M576 350 Q622 334 656 304 Q644 350 628 368 Q604 352 576 350 Z M656 304 Q722 332 790 338 Q762 322 744 298 Z" fill="url(#{id}-hairTop)" ${THIN}/>
  <g class="rig rig-blink">
    <ellipse cx="618" cy="388" rx="21" ry="29" fill="${INK}"/>
    <ellipse cx="738" cy="382" rx="20" ry="27" fill="${INK}"/>
    <circle cx="610" cy="374" r="7" fill="#fff"/><circle cx="627" cy="400" r="3.5" fill="#fff"/>
    <circle cx="730" cy="369" r="6.5" fill="#fff"/><circle cx="747" cy="394" r="3.5" fill="#fff"/>
  </g>
  <path d="M584 360 Q618 344 646 362 M712 356 Q740 344 768 360" fill="none" stroke="${INK}" stroke-width="10" stroke-linecap="round"/>
  <ellipse cx="588" cy="428" rx="15" ry="8" fill="#ff9cc4" opacity=".55"/><ellipse cx="770" cy="420" rx="15" ry="8" fill="#ff9cc4" opacity=".55"/>
  <path d="M660 428 Q680 440 700 428" fill="none" stroke="${INK}" stroke-width="9" stroke-linecap="round"/>
  <path d="M686 432 L694 450 L702 430 Z" fill="#fff" ${THIN}/>
  <g class="rig rig-sway rig-ahoge">
    <path d="M690 152 C672 152 654 148 646 140" fill="none" ${LINE}/>
    <path transform="translate(646 108) scale(1.35) translate(-646 -108)" d="M646 142 C598 116 596 72 628 70 C640 70 646 78 646 86 C646 78 654 70 666 70 C696 72 694 116 646 142 Z" fill="#ff8ec2" ${LINE}/>
    <ellipse cx="618" cy="84" rx="9" ry="5.5" fill="#fff" opacity=".75" transform="rotate(-30 618 84)"/>
  </g>
  <path d="M822 176 L852 124 L884 166 L852 178 Z" fill="#7a4cc8" ${THIN}/>
  <circle cx="806" cy="206" r="32" fill="#ffb4d8" ${LINE}/><circle cx="796" cy="196" r="9" fill="#fff" opacity=".75"/>
</g>`;

const staff = `
<g class="rig rig-sway rig-staff">
  <path d="M438 430 L546 584" fill="none" stroke="${INK}" stroke-width="34" stroke-linecap="round"/>
  <path d="M438 430 L546 584" fill="none" stroke="#f3c6ef" stroke-width="20" stroke-linecap="round"/>
  <circle cx="405" cy="338" r="98" fill="url(#{id}-candy)" ${LINE}/>
  <path d="M405 338 c0 -12 16 -16 25 -8 c14 12 7 36 -16 41 c-34 7 -57 -22 -48 -54 c11 -39 64 -52 94 -22" fill="none" stroke="#fff" stroke-width="15" stroke-linecap="round" opacity=".9"/>
  <path d="M405 338 c0 -12 16 -16 25 -8 c14 12 7 36 -16 41 c-34 7 -57 -22 -48 -54 c11 -39 64 -52 94 -22" fill="none" stroke="#b64a9c" stroke-width="5" stroke-linecap="round" opacity=".6"/>
  <g class="rig rig-drip rig-drip-a"><path d="M330 412 L330 540 Q330 566 349 566 Q368 566 368 540 L368 412 Z" fill="url(#{id}-syrup)" ${THIN}/></g>
  <g class="rig rig-drip rig-drip-b"><path d="M400 434 L400 606 Q400 634 420 634 Q440 634 440 606 L440 434 Z" fill="url(#{id}-syrup)" ${THIN}/></g>
  <g class="rig rig-drip rig-drip-c"><path d="M372 606 Q394 650 372 686 Q350 650 372 606 Z" fill="url(#{id}-syrup)" ${THIN}/></g>
</g>`;

registerCharacterArt("sweetna", {
  viewBox: "60 28 1280 1092",
  defs,
  body: `${puddle}<g class="rig rig-float">${wingLeft}${wingRight}${hairBack}${legs}${dress}${armHold}${head}${staff}</g>`
});
