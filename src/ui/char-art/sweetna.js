import { registerCharacterArt } from "../char-art.js";

/* 스위트나: 하트 더듬이, 박쥐 날개, 긴 머리, 사탕 지팡이를 든 데포르메 소녀. 원본 스케치 좌표(약 1475×1102)를 따라 한 겹의 윤곽선으로 다시 그렸다.
   부품(rig-*)은 뒤→앞 순서로 그룹지어 CSS가 움직인다. */
const defs = `
<linearGradient id="{id}-hairTop" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe9f4"/><stop offset=".7" stop-color="#ffbfe0"/><stop offset="1" stop-color="#f79fcf"/></linearGradient>
<linearGradient id="{id}-hairBack" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ee86c3"/><stop offset="1" stop-color="#a64d9e"/></linearGradient>
<linearGradient id="{id}-skin" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff3ec"/><stop offset="1" stop-color="#ffd6cc"/></linearGradient>
<linearGradient id="{id}-dress" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff8fb"/><stop offset="1" stop-color="#ffc6e0"/></linearGradient>
<linearGradient id="{id}-wing" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9a68d8"/><stop offset="1" stop-color="#4a2886"/></linearGradient>
<radialGradient id="{id}-candy" cx=".38" cy=".34" r=".8"><stop offset="0" stop-color="#ffe3f1"/><stop offset=".5" stop-color="#ff9ccb"/><stop offset="1" stop-color="#e2568f"/></radialGradient>
<linearGradient id="{id}-syrup" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff8bbd"/><stop offset="1" stop-color="#e2478a"/></linearGradient>
<linearGradient id="{id}-stick" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#ffb3d6"/></linearGradient>
<radialGradient id="{id}-puddle" cx=".5" cy=".45" r=".6"><stop offset="0" stop-color="#ffd0e6" stop-opacity=".95"/><stop offset="1" stop-color="#ff7fb8" stop-opacity=".78"/></radialGradient>
<linearGradient id="{id}-shoe" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7a4592"/><stop offset="1" stop-color="#4a2660"/></linearGradient>
<linearGradient id="{id}-heart" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffb3d9"/><stop offset="1" stop-color="#ff5fa8"/></linearGradient>
<radialGradient id="{id}-bead" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#ff9ccb"/></radialGradient>
<linearGradient id="{id}-ribbon" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c79bff"/><stop offset="1" stop-color="#7a4cc8"/></linearGradient>
<linearGradient id="{id}-creature" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff6fa"/><stop offset="1" stop-color="#ffc9e2"/></linearGradient>
`;

const body = `
<g class="rig rig-puddle">
  <ellipse class="rig rig-ripple" cx="372" cy="1006" rx="300" ry="40" fill="none" stroke="#ff9ccb" stroke-width="7" opacity=".55"/>
  <path d="M104 1018 C100 990 190 968 300 972 C360 958 470 958 560 976 C620 986 650 1004 636 1022 C620 1046 520 1052 430 1048 C340 1056 200 1058 140 1046 C118 1040 106 1030 104 1018 Z" fill="url(#{id}-puddle)" stroke="#6a2f86" stroke-width="12" stroke-linejoin="round"/>
  <path d="M170 1000 C230 988 330 984 410 990" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" opacity=".55"/>
  <g class="rig rig-peek">
    <path d="M322 1004 L330 944 L362 966 C376 960 396 960 410 966 L442 944 L450 1004 C420 1018 352 1018 322 1004 Z" fill="url(#{id}-creature)" stroke="#6a2f86" stroke-width="10" stroke-linejoin="round"/>
    <ellipse cx="358" cy="986" rx="7" ry="9" fill="#4a2660"/><ellipse cx="414" cy="986" rx="7" ry="9" fill="#4a2660"/>
    <path d="M378 1000 Q386 1008 394 1000" fill="none" stroke="#4a2660" stroke-width="5" stroke-linecap="round"/>
  </g>
  <circle cx="330" cy="905" r="9" fill="#ff8bbd"/><circle cx="440" cy="888" r="7" fill="#ff8bbd"/><circle cx="486" cy="916" r="6" fill="#ffb3d6"/>
</g>
<g class="rig rig-flap rig-flap-l">
  <path d="M565 482 C450 432 270 362 120 300 Q177 406 14 470 Q137 539 20 640 Q164 653 82 772 Q190 690 330 612 Q470 572 565 482 Z" fill="url(#{id}-wing)" stroke="#3b2150" stroke-width="14" stroke-linejoin="round"/>
  <path d="M565 482 C400 424 230 352 120 300 M565 482 C390 500 150 520 14 470 M565 482 C380 540 150 600 20 640 M565 482 C400 580 220 700 82 772" fill="none" stroke="#2c1658" stroke-width="10" stroke-linecap="round" opacity=".8"/>
  <path d="M520 470 C400 420 260 380 170 345" fill="none" stroke="#d9bcff" stroke-width="7" stroke-linecap="round" opacity=".5"/>
  <path d="M470 520 C330 530 190 560 90 590" fill="none" stroke="#d9bcff" stroke-width="6" stroke-linecap="round" opacity=".28"/>
</g>
<g class="rig rig-flap rig-flap-r">
  <path d="M905 340 C1020 220 1170 120 1332 80 Q1270 217 1415 250 Q1289 349 1380 420 Q1241 494 1292 622 Q1180 560 1090 530 Q990 500 905 440 Z" fill="url(#{id}-wing)" stroke="#3b2150" stroke-width="14" stroke-linejoin="round"/>
  <path d="M905 380 C1040 250 1190 130 1332 80 M905 400 C1080 330 1280 290 1415 250 M905 420 C1080 400 1270 420 1380 420 M905 440 C1060 470 1200 540 1292 622" fill="none" stroke="#2c1658" stroke-width="10" stroke-linecap="round" opacity=".8"/>
  <path d="M960 340 C1080 240 1190 170 1290 130" fill="none" stroke="#d9bcff" stroke-width="7" stroke-linecap="round" opacity=".5"/>
  <path d="M1000 440 C1120 380 1240 350 1340 330" fill="none" stroke="#d9bcff" stroke-width="6" stroke-linecap="round" opacity=".28"/>
</g>
<g class="rig rig-sway rig-hair-r">
  <path d="M860 230 C905 330 925 470 985 600 C1030 660 1090 690 1096 760 C1096 820 1030 868 940 884 C880 892 820 884 784 850 C830 846 868 820 880 780 C892 730 870 680 840 620 C810 570 790 520 792 460 Z" fill="url(#{id}-hairBack)" stroke="#3b2150" stroke-width="14" stroke-linejoin="round"/>
  <path d="M928 420 C968 520 1010 610 1048 690 C1062 740 1040 800 970 842" fill="none" stroke="#ffd3ea" stroke-width="9" stroke-linecap="round" opacity=".5"/>
</g>
<g class="rig rig-sway rig-hair-l">
  <path d="M520 300 C498 380 496 460 516 520 C528 556 560 570 586 540 C596 480 590 400 582 330 Z" fill="url(#{id}-hairBack)" stroke="#3b2150" stroke-width="14" stroke-linejoin="round"/>
</g>
<g class="rig rig-legs">
  <path d="M626 700 L640 800 L682 800 L684 700 Z" fill="url(#{id}-skin)" stroke="#3b2150" stroke-width="12" stroke-linejoin="round"/>
  <path d="M706 704 L716 800 L756 800 L760 704 Z" fill="url(#{id}-skin)" stroke="#3b2150" stroke-width="12" stroke-linejoin="round"/>
  <path d="M600 798 C598 840 640 848 684 840 L686 798 Z" fill="url(#{id}-shoe)" stroke="#3b2150" stroke-width="12" stroke-linejoin="round"/>
  <path d="M694 800 C694 842 730 850 760 842 L762 802 Z" fill="url(#{id}-shoe)" stroke="#3b2150" stroke-width="12" stroke-linejoin="round"/><path d="M606 812 C630 806 660 806 680 812 M700 814 C722 808 744 808 760 814" fill="none" stroke="#d9bcff" stroke-width="6" stroke-linecap="round" opacity=".55"/>
</g>
<path d="M650 470 C644 520 626 570 596 640 C588 670 590 690 596 704 C610 716 626 708 640 714 C654 722 668 714 682 718 C698 724 712 714 726 718 C742 722 756 714 770 718 C788 722 804 712 818 714 C840 710 858 696 864 680 C866 652 852 620 824 590 C806 548 802 500 796 470 Z" fill="url(#{id}-dress)" stroke="#3b2150" stroke-width="13" stroke-linejoin="round"/>
<path d="M770 520 C792 560 820 590 846 640 C862 660 862 684 840 700 C820 706 800 700 790 700 C800 640 790 580 770 520 Z" fill="#d06aa0" opacity=".16"/>
<path d="M642 592 C700 608 762 606 812 588 L818 614 C762 632 700 634 636 616 Z" fill="url(#{id}-ribbon)" stroke="#3b2150" stroke-width="10" stroke-linejoin="round"/>
<path d="M690 650 C694 676 692 696 686 714 M750 654 C752 678 756 698 764 714" fill="none" stroke="#e7a6cd" stroke-width="8" stroke-linecap="round" opacity=".6"/>
<path d="M792 486 C836 496 906 516 962 544 C954 560 950 576 940 598 C930 590 920 592 910 598 C898 586 880 584 868 580 C848 574 820 566 800 556 Z" fill="url(#{id}-dress)" stroke="#3b2150" stroke-width="12" stroke-linejoin="round"/>
<g class="rig rig-head">
  <path d="M572 360 C568 432 640 454 712 452 C790 452 852 432 854 366 C854 322 784 302 712 306 C640 306 576 320 572 360 Z" fill="url(#{id}-skin)" stroke="#3b2150" stroke-width="13" stroke-linejoin="round"/>
  <g class="rig rig-blink">
    <ellipse cx="621" cy="386" rx="15" ry="25" fill="#3b2150"/><ellipse cx="621" cy="398" rx="10" ry="12" fill="#8b5ad6" opacity=".7"/><ellipse cx="615" cy="376" rx="5" ry="8" fill="#fff"/>
    <ellipse cx="742" cy="383" rx="14" ry="23" fill="#3b2150"/><ellipse cx="742" cy="394" rx="9" ry="11" fill="#8b5ad6" opacity=".7"/><ellipse cx="736" cy="374" rx="5" ry="7" fill="#fff"/>
  </g>
  <ellipse cx="590" cy="420" rx="22" ry="10" fill="#ff9ec4" opacity=".45"/><ellipse cx="800" cy="414" rx="22" ry="10" fill="#ff9ec4" opacity=".45"/>
  <path d="M690 412 Q701 424 712 412 Q724 424 735 410" fill="none" stroke="#3b2150" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M697 418 L706 436 L713 418 Z" fill="#fff" stroke="#3b2150" stroke-width="6" stroke-linejoin="round"/>
  <path d="M576 338 C596 364 624 370 652 344 C672 358 702 356 716 324 C738 354 766 356 792 334 C812 356 842 350 862 338 L862 316 L576 316 Z" fill="#a8527c" opacity=".2"/>
  <path d="M508 330 C502 240 556 172 660 156 C764 146 862 192 880 290 C886 328 872 334 862 334 C842 348 810 346 792 322 C766 342 738 340 716 308 C702 342 672 348 652 332 C624 356 596 352 576 334 C552 338 520 344 508 330 Z" fill="url(#{id}-hairTop)" stroke="#3b2150" stroke-width="14" stroke-linejoin="round"/>
  <path d="M600 215 C650 185 730 180 800 215 M560 270 C580 240 600 232 620 228" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" opacity=".6"/>
  <g class="rig rig-ahoge">
    <path d="M650 176 C600 148 590 100 626 94 C642 92 652 102 652 114 C652 102 664 92 680 94 C716 100 704 150 650 176 Z" fill="url(#{id}-heart)" stroke="#3b2150" stroke-width="13" stroke-linejoin="round"/>
    <path d="M618 108 C622 100 632 100 636 108" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" opacity=".7"/>
  </g>
  <circle cx="812" cy="210" r="26" fill="url(#{id}-bead)" stroke="#3b2150" stroke-width="11"/><circle cx="803" cy="201" r="7" fill="#fff" opacity=".8"/>
  <path d="M858 170 C832 138 812 148 820 176 C828 198 848 192 858 170 Z M858 170 C886 138 906 148 898 178 C890 200 868 192 858 170 Z" fill="url(#{id}-ribbon)" stroke="#3b2150" stroke-width="10" stroke-linejoin="round"/><circle cx="858" cy="172" r="10" fill="#9b6be0" stroke="#3b2150" stroke-width="8"/></g>
<g class="rig rig-staff">
  <path d="M446 432 L578 640 L552 652 L424 450 Z" fill="url(#{id}-stick)" stroke="#3b2150" stroke-width="12" stroke-linejoin="round"/>
  <path d="M344 410 C342 470 344 530 352 560 C356 580 372 580 376 560 C378 520 380 470 384 430 Z M408 432 C410 500 410 570 416 616 C420 630 436 630 440 614 C442 560 440 500 442 450 Z" fill="url(#{id}-syrup)" stroke="#3b2150" stroke-width="12" stroke-linejoin="round" class="rig rig-drip"/>
  <ellipse class="rig rig-drop" cx="358" cy="664" rx="22" ry="36" fill="url(#{id}-syrup)" stroke="#3b2150" stroke-width="11"/>
  <circle cx="405" cy="335" r="92" fill="url(#{id}-candy)" stroke="#3b2150" stroke-width="14"/>
  <path d="M405 335 m0 0 c0 -12 14 -18 24 -12 c14 8 12 28 -4 36 c-24 12 -52 -6 -50 -34 c2 -34 38 -50 66 -34 c34 20 30 70 -6 82" fill="none" stroke="#fff" stroke-width="14" stroke-linecap="round" opacity=".92"/>
  <path d="M345 300 C352 270 376 252 404 250" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" opacity=".7"/>
  <path d="M660 508 C620 530 592 548 556 572" fill="none" stroke="#3b2150" stroke-width="60" stroke-linecap="round"/><path d="M660 508 C620 530 592 548 556 572" fill="none" stroke="#fff3f8" stroke-width="36" stroke-linecap="round"/>
  <circle cx="548" cy="575" r="24" fill="url(#{id}-skin)" stroke="#3b2150" stroke-width="12"/>
</g>
`;

registerCharacterArt("sweetna", {
  viewBox: "0 60 1440 1040",
  defs,
  body: `<g class="rig rig-float">${body}</g>`
});
