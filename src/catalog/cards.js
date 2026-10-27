// Owned mutable state. Imported by the subsystem and its explicit consumers.
export const state_catalog_cards = {
  C: undefined,
  S: undefined,
  CARDS: undefined,
  BASE_IDS: undefined,
  TWO_STAR_IDS: undefined,
  MEGA_IDS: undefined,
  SPECIAL_IDS: undefined,
  PLUS_STAR_ELIGIBLE: undefined,
  PlusStarModifierOwner: undefined,
  EffectiveCardPresentationOwner: undefined,
  FormFamilyOwner: undefined
};
import { other } from "../engine/actions.js";
import { queueVisual, traitsActive } from "../engine/combat.js";
import { costTokens } from "../engine/energy.js";
import { card, resolvePlusStarChoice, skillOf } from "../engine/entities.js";
import { log } from "../presentation/audio.js";
import { systems } from "../runtime/systems.js";
import { state_ui_battle_state } from "../ui/battle-state.js";
import { cardEmoji } from "../ui/cards.js";
import { state_ui_deck } from "../ui/deck.js";
export function initializeCatalogCards() {
  state_catalog_cards.C = (id, name, hp, role, complexity, trait, skills, extra = {}) => {
    /* R41: firstSkillId/isDragon/defense 같은 파생 별칭은 카드마다 저장하지 않는다.
       기술 순서·tags·baseDefense라는 원본 정보에서 공통 질의기로 계산한다. */
    const {
      firstSkillId: _derivedFirstSkillId,
      isDragon: _derivedIsDragon,
      defense: legacyDefense,
      ...sourceExtra
    } = extra || {};
    return {
      id,
      name,
      hp,
      maxHp: hp,
      role,
      complexity,
      trait,
      traits: sourceExtra.traits || [trait],
      skills: Array.isArray(skills) ? skills : [],
      grade: sourceExtra.grade || "2☆",
      league: sourceExtra.league || (complexity === "메가리그" ? "mega" : "base"),
      baseDefense: sourceExtra.baseDefense ?? legacyDefense ?? 0,
      maxEnergy: sourceExtra.maxEnergy || 4,
      tags: [...new Set(sourceExtra.tags || [])],
      formGroup: sourceExtra.formGroup || null,
      hiddenUntilRevealed: sourceExtra.hiddenUntilRevealed !== false,
      ...sourceExtra
    };
  };
  state_catalog_cards.S = (id, name, cost, desc, target, effects, tags = [], extra = {}) => ({
    id,
    name,
    cost,
    desc,
    target,
    effects,
    tags,
    ...extra
  });
  state_catalog_cards.CARDS = [state_catalog_cards.C("hermit", "큰뿔소라게", 60, "특수 탱커", "사용자 제작", "공격기의 매 타격을 받을 때 공격자에게 고정 반사 피해 30.", [state_catalog_cards.S("sandstorm", "모래폭풍", "W**", "40D. 피해 후 대상의 모든 에너지 색을 W로 변경.", "enemy", [{
    type: "damage",
    amount: 40
  }, {
    type: "colorAll",
    color: "W"
  }], ["energy"]), state_catalog_cards.S("hide", "모래숨기", "W", "다음 두 공격 타격의 피해를 각각 30 감소(최대 2회).", "self", [{
    type: "nextHitReduction",
    amount: 30,
    hits: 2
  }], ["shield"])], {
    shield: 60,
    reflect: 30
  }), state_catalog_cards.C("stareel", "별장어", 140, "슬롯 통제", "사용자 제작", "마비 면역. 공격 시 33% 크리티컬(150%). 공격·방어 수치가 공격자에게 불리하게 반영되면 무시.", [state_catalog_cards.S("tackle", "전기태클", "W", "적 필드 슬롯에 1회용 함정 설치. 다음 출전자는 마비 4턴.", "enemySlot", [{
    type: "slotTrap",
    status: "paralyze",
    duration: 4
  }], ["trap"]), state_catalog_cards.S("whip", "전기채찍", "W*", "70D. 독립적으로 33% 마비 2턴.", "enemy", [{
    type: "damage",
    amount: 70,
    crit: 0.33
  }, {
    type: "statusChance",
    status: "paralyze",
    duration: 2,
    chance: 0.33
  }], ["damage", "status"])], {
    crit: 0.33,
    paralyzeImmune: true
  }), state_catalog_cards.C("mole", "화살두더지", 125, "안정 딜러", "단순", "없음.", [state_catalog_cards.S("shot", "흙화살", "R", "35D.", "enemy", [{
    type: "damage",
    amount: 35
  }], ["damage"]), state_catalog_cards.S("pierce", "관통화살", "R*", "70D. 대상 방어가 양수면 피해 계산 시 방어 5만 적용.", "enemy", [{
    type: "damage",
    amount: 70,
    defCap: 5
  }], ["damage"])]), state_catalog_cards.C("boar", "바위멧돼지", 150, "안정 딜러", "단순", "없음.", [state_catalog_cards.S("ram", "바위돌진", "B", "40D.", "enemy", [{
    type: "damage",
    amount: 40
  }], ["damage"]), state_catalog_cards.S("quake", "지면강타", "BB*", "105D.", "enemy", [{
    type: "damage",
    amount: 105
  }], ["damage"])]), state_catalog_cards.C("mantis", "쌍날사마귀", 115, "안정 딜러", "단순", "없음.", [state_catalog_cards.S("twin", "쌍날베기", "R*", "35D씩 2회.", "enemy", [{
    type: "damage",
    amount: 35,
    hits: 2
  }], ["damage", "multi"])]), state_catalog_cards.C("fang", "유리송곳니", 85, "저HP 고화력", "조건부", "실드가 없을 때 공격 피해 +10.", [state_catalog_cards.S("bite", "유리이빨", "R", "45D.", "enemy", [{
    type: "damage",
    amount: 45,
    noShieldBonus: 10
  }], ["damage"]), state_catalog_cards.S("shatter", "파쇄돌진", "RR*", "120D.", "enemy", [{
    type: "damage",
    amount: 120,
    noShieldBonus: 10
  }], ["damage"])]), state_catalog_cards.C("frog", "폭탄개구리", 90, "저HP 고화력", "조건부", "없음.", [state_catalog_cards.S("spark", "도화선", "R", "40D. 자신에게 고정 피해 5.", "enemy", [{
    type: "damage",
    amount: 40
  }, {
    type: "selfDamage",
    amount: 5
  }], ["damage"]), state_catalog_cards.S("blast", "폭발도약", "R**", "115D. 자신에게 고정 피해 15.", "enemy", [{
    type: "damage",
    amount: 115
  }, {
    type: "selfDamage",
    amount: 15
  }], ["damage"])]), state_catalog_cards.C("turtle", "철갑거북", 160, "방어 탱커", "단순", "기본 방어 10.", [state_catalog_cards.S("bash", "등껍질치기", "B", "45D.", "enemy", [{
    type: "damage",
    amount: 45
  }], ["damage"]), state_catalog_cards.S("brace", "버티기", "W", "35D. 공격 후 자신의 방어 +5(최대 20).", "enemy", [{
    type: "damage",
    amount: 35
  }, {
    type: "selfDefense",
    amount: 5,
    max: 20
  }], ["damage", "defense"])], {
    baseDefense: 10
  }), state_catalog_cards.C("mushroom", "방패버섯", 120, "실드 탱커", "단순", "시작 실드 20.", [state_catalog_cards.S("bump", "방패밀기", "B", "25D.", "enemy", [{
    type: "damage",
    amount: 25
  }], ["damage"]), state_catalog_cards.S("spores", "보호포자", "W*", "아군 하나에게 실드 20(실드 최대 50).", "ally", [{
    type: "shield",
    amount: 20,
    max: 50
  }], ["shield"])], {
    shield: 20
  }), state_catalog_cards.C("bee", "꿀벌의사", 110, "회복 지원", "단순", "없음.", [state_catalog_cards.S("needle", "침찌르기", "R", "25D.", "enemy", [{
    type: "damage",
    amount: 25
  }], ["damage"]), state_catalog_cards.S("honey", "응급꿀", "W*", "아군 하나의 HP 40 회복.", "ally", [{
    type: "heal",
    amount: 40
  }], ["heal"])]), state_catalog_cards.C("tail", "흰꼬리새", 120, "에너지 지원", "단순", "없음.", [state_catalog_cards.S("peck", "흰부리", "W", "30D.", "enemy", [{
    type: "damage",
    amount: 30
  }], ["damage"]), state_catalog_cards.S("pass", "날개전달", "*", "자신의 에너지 1개를 지불하고 다른 필드 아군에게 같은 색 에너지 1개 전달.", "allyOther", [{
    type: "transferPaidEnergy"
  }], ["support"])]), state_catalog_cards.C("ember", "잿불여우", 115, "상태이상 템포", "단순", "없음.", [state_catalog_cards.S("cinder", "불씨물기", "R*", "50D. 화상 2턴.", "enemy", [{
    type: "damage",
    amount: 50
  }, {
    type: "status",
    status: "burn",
    duration: 2
  }], ["damage", "status"])]), state_catalog_cards.C("snail", "늪달팽이", 145, "상태이상 템포", "조건부", "상대가 직전 자기 차례에 에너지를 모았다면 진흙탄 피해 +15.", [state_catalog_cards.S("mud", "진흙탄", "B*", "45D. 감속 2턴.", "enemy", [{
    type: "damage",
    amount: 45,
    ifTargetGathered: 15
  }, {
    type: "status",
    status: "slow",
    duration: 2
  }], ["damage", "status"])]), state_catalog_cards.C("chameleon", "색도마뱀", 120, "에너지 색 조작", "독특", "없음.", [state_catalog_cards.S("paint", "색칠혀", "W", "20D. 대상 에너지 하나를 R로 변경(위협 기술을 가장 늦추는 에너지 우선).", "enemy", [{
    type: "damage",
    amount: 20
  }, {
    type: "colorOne",
    color: "R"
  }], ["damage", "energy"]), state_catalog_cards.S("wash", "색씻기", "B*", "60D. 대상 에너지 하나를 W로 변경.", "enemy", [{
    type: "damage",
    amount: 60
  }, {
    type: "colorOne",
    color: "W"
  }], ["damage", "energy"])]), state_catalog_cards.C("cloud", "먹구름", 130, "에너지 개수 조작", "조건부", "기술 사용 후 에너지가 0이면 그 공격 피해 +15.", [state_catalog_cards.S("drizzle", "먹비", "B", "30D.", "enemy", [{
    type: "damage",
    amount: 30,
    lastEnergyBonus: 15
  }], ["damage"]), state_catalog_cards.S("drain", "검은소나기", "B**", "80D. 대상의 반에너지 1개를 우선 제거하며, 없으면 에너지 1개 제거.", "enemy", [{
    type: "damage",
    amount: 80,
    lastEnergyBonus: 15
  }, {
    type: "removeEnergy",
    amount: 1
  }], ["damage", "energy"])]), state_catalog_cards.C("hawk", "추적매", 105, "연속 표적 기믹", "독특", "직전 자신의 공격과 같은 대상을 공격하면 피해 +20. 교체하면 표식이 사라진다.", [state_catalog_cards.S("mark", "추적발톱", "R", "35D.", "enemy", [{
    type: "damage",
    amount: 35,
    sameTargetBonus: 20
  }], ["damage"]), state_catalog_cards.S("dive", "급강하", "R*", "65D.", "enemy", [{
    type: "damage",
    amount: 65,
    sameTargetBonus: 20
  }], ["damage"])]), state_catalog_cards.C("wayli", "웨이리", 240, "무코스트 지속 딜러", "메가리그", "공방무시: 웨이리가 공격하거나 공격받을 때 양측의 공격력·방어력 증감을 무시한다.", [state_catalog_cards.S("waterbarrage", "물총세례", "", "30D.", "enemy", [{
    type: "damage",
    amount: 30
  }], ["damage", "free"])], {
    grade: "4☆",
    ignoreStatChanges: true
  }), state_catalog_cards.C("bkeno", "브케노", 170, "폭발 딜러", "메가리그", "없음.", [state_catalog_cards.S("earthquake", "지진", "RW*", "160D. 공격 판정 후 양쪽 필드의 모든 에너지를 제거한다.", "enemy", [{
    type: "damage",
    amount: 160
  }, {
    type: "clearFieldEnergy"
  }], ["damage", "energy", "fieldClear"]), state_catalog_cards.S("eruption", "분화", "RR**", "67%: 210D, 33%: 230D. 피해 결정 후 난수 적용. 실드멜트.", "enemy", [{
    type: "damage",
    amount: 210,
    boostAmount: 230,
    boostChance: 0.33,
    shieldMelt: true
  }], ["damage", "shieldMelt"], {
    runtimeKind: "randomShieldMeltHit"
  })], {
    grade: "4☆",
    formGroup: "brkeno",
    baseFormId: "bkeno",
    alternateFormId: "huve"
  }), state_catalog_cards.C("huve", "휴브", 340, "변동 자원 화산 딜러", "메가리그", "없음.", [state_catalog_cards.S("mysticBurst", "미스틱버스트", "WB*+", "100D. 기본 WB* 뒤 추가 R당 +30D, W당 HP50 회복, B당 무작위 상태이상2.", "enemy", [{
    type: "mysticBurst"
  }], ["damage", "heal", "status", "variableCost"]), state_catalog_cards.S("huveEarthquake", "지진", "WR**", "160D 후 살아 있는 필드 전원의 에너지를 전부 제거.", "enemy", [{
    type: "damage",
    amount: 160
  }, {
    type: "clearFieldEnergy"
  }], ["damage", "energy", "fieldClear"]), state_catalog_cards.S("smackdown", "스맥다운", "***", "80D 후 대상 에너지 제거, 제거량×30 피해를 양쪽에 줌(실드 우선, 초과 이월 없음).", "enemy", [{
    type: "mutualEnergyTrade",
    baseDamage: 80,
    perEnergyDamage: 30,
    selfDamagePerEnergy: 30,
    step: 0.5
  }], ["damage", "energy", "fixedDamage"], {
    interaction: {
      kind: "targetEnergyRemoval",
      step: 0.5
    },
    aiProfile: {
      kind: "mutualEnergyTrade",
      baseDamage: 80,
      perEnergyDamage: 30,
      selfDamagePerEnergy: 30
    }
  })], {
    grade: "4.5☆",
    speed: -1,
    maxEnergy: 5,
    formGroup: "brkeno",
    baseFormId: "bkeno",
    alternateFormId: "huve"
  }), state_catalog_cards.C("master", "마스터", 140, "순풍 다단 딜러", "메가리그", "없음.", [state_catalog_cards.S("tailwind", "순풍", "W", "공통 무작위 에너지 후보군에서 에너지 3개를 순서대로 획득.", "self", [{
    type: "masterTailwind",
    count: 3
  }], ["energy"]), state_catalog_cards.S("leafBlade", "잎날수리검", "**", "30D씩 무작위 1~3회.", "enemy", [{
    type: "randomMultiHit",
    amount: 30
  }], ["damage", "multi"], {
    hitRange: [1, 3],
    vfxTheme: "leafBlade"
  })], {
    grade: "3☆",
    speed: 1,
    plusStar: {
      skills: {
        leafBlade: {
          hitRange: [2, 4],
          description: "30D씩 무작위 2~4회."
        }
      }
    }
  }), state_catalog_cards.C("sweetna", "스위트나", 170, "독 연속 딜러", "메가리그", "독 비례 공격 +10a. 독 걸린 적이 스위트나 진영을 칠 때마다 -10a. 적이 상태이상 강제 해제 시 에너지 전부 상실.", [state_catalog_cards.S("sugarswamp", "슈가스웜프", "R**", "즉시 30D+독3. 이후 자기 차례 두 번을 소비해 지정한 적 슬롯을 자동 반복 공격한다.", "enemy", [{
    type: "damage",
    amount: 30,
    sweetPoisonBonus: true
  }, {
    type: "status",
    status: "poison",
    duration: 3
  }, {
    type: "startSequence",
    remaining: 2
  }], ["damage", "status", "sequence"])], {
    grade: "3.5☆",
    sweetna: true,
    plusStar: {
      skills: {
        sugarswamp: {
          target: "enemyField",
          followUpPolicy: "slot-snapshot",
          description: "적 필드 전체에 즉시 30D+독3. 이후 기존 슈가스웜프 예약 공격을 수행한다."
        }
      }
    }
  }), state_catalog_cards.C("iruma", "이루마", 150, "피해 이전 지원", "메가리그", "피해경감: 개별 피해 -40. 즉시 치료: 필드 아군의 새 상태이상 제거, 개당 HP 20 회복(회복 확산 발동). 회복 확산: 이루마가 아군을 회복시키면 그 대상이 직전 잃은 HP의 1/3만큼 필드 아군 전체 추가 회복.", [state_catalog_cards.S("shift", "시프트", "**", "필드의 다른 아군이 이미 잃은 HP를 최대 150까지 되돌리고, 같은 양의 피해를 이루마에게 이전.", "allyOtherAny", [{
    type: "shift",
    amount: 150
  }], ["support"]), state_catalog_cards.S("liferain", "라이프레인", "W*", "적 전체 0D·방어 -10·감속2. 사용 직전 이루마 HP의 1/3을 필드 아군에 원하는 비율로 분배 회복(실제 회복된 대상마다 회복 확산 발동).", "field", [{
    type: "lifeRain"
  }], ["damage", "heal", "status"])], {
    grade: "4☆",
    formGroup: "iruma",
    damageReduction: 40,
    irumaCleanse: true,
    healingSplashMissingRatio: 1 / 3
  }), state_catalog_cards.C("iceknight", "빙마기수", 230, "복합 제어 딜러", "메가리그", "냉동 흡수: 냉동 적용을 무효화하고 HP20을 얻는다. 최대 HP를 초과할 수 있다.", [state_catalog_cards.S("iceRoar", "빙천포효", "WB", "자신을 포함한 빙마기수 외 필드 전원에게 냉동2. 자신은 냉동 흡수 발동.", "field", [{
    type: "iceRoar"
  }], ["status"]), state_catalog_cards.S("rampage", "날뛰기", "*", "기본 코스트와 양쪽 저장소에서 추가 제거한 에너지 총량×10D.", "enemy", [{
    type: "rampage"
  }], ["damage"]), state_catalog_cards.S("shatterLance", "파쇄창", "WR*", "70D+대상 냉동 지속시간×30D. 피해 후 냉동 제거.", "enemy", [{
    type: "shatterLance"
  }], ["damage"])], {
    grade: "4☆",
    speed: 1,
    dualActor: true,
    freezeAbsorb: true,
    freezeAbsorbHeal: 20
  }), state_catalog_cards.C("awakenedIruma", "각성이루마", 170, "예약 광역 딜러", "메가리그", "없음.", [state_catalog_cards.S("bloomingLife", "피어나는생명", "W*", "다음 자기 차례에 적 필드에 총 320D 분산. 대기 중 상태이상 면역. 실질 피해의 50% 회복.", "field", [{
    type: "bloomingLife"
  }], ["damage", "heal", "scheduled"])], {
    grade: "4.5☆",
    formGroup: "iruma"
  }), state_catalog_cards.C("dragonfish", "드래곤피시", 240, "상태이상 딜러", "메가리그", "심해 내성: 기본 방어 -20. 독과 감속에 면역.", [state_catalog_cards.S("deepTornado", "심해의토네이도", "*", "60D.", "enemy", [{
    type: "damage",
    amount: 60
  }], ["damage"]), state_catalog_cards.S("maul", "물어뜯기", "BB", "120D. 피해 후 독2와 감속2.", "enemy", [{
    type: "damage",
    amount: 120
  }, {
    type: "status",
    status: "poison",
    duration: 2
  }, {
    type: "status",
    status: "slow",
    duration: 2
  }], ["damage", "status"])], {
    grade: "4☆",
    baseDefense: -20,
    tags: ["dragon"],
    poisonImmune: true,
    slowImmune: true,
    nullifyTrait: true,
    baseDefenseTraitBound: true
  }), state_catalog_cards.C("silvrae", "실브래", 220, "실드 보호 드래곤", "메가리그", "냉동·마비 외 상태이상 면역. 실드 대신피해: 실드 보유 중 아군 공격 피해 절반을 대신 받음. 기술 사용 시 HP10 회복.", [state_catalog_cards.S("firstGuard", "퍼스트가드", "", "전투 1회. 40D 후 실드120.", "enemy", [{
    type: "damage",
    amount: 40
  }, {
    type: "selfShield",
    amount: 120
  }], ["damage", "shield"], {
    once: true,
    runtimeKind: "openingGuard"
  }), state_catalog_cards.S("silverSmash", "실버스매시", "******", "대상 에너지 수만큼 실제 * 코스트 감소(최소0). 70D.", "enemy", [{
    type: "damage",
    amount: 70
  }], ["damage", "dynamicCost"], {
    runtimeKind: "dynamicDefenseSmash"
  }), state_catalog_cards.S("dragonMemory", "드래곤메모리", "", "전투 중 1회. 아직 출전하지 않은 후열 드래곤의 첫 번째 기술을 원본과 같은 코스트·대상·효과로 복사한다.", "copyDragon", [], ["copy"], {
    interaction: {
      kind: "copyDragonSkill"
    },
    runtimeKind: "copyDragonSkill"
  })], {
    grade: "4☆",
    maxEnergy: 6,
    tags: ["dragon"],
    immunities: ["poison", "slow", "burn", "traitSeal", "skillSeal", "healSeal"],
    shieldProtector: true,
    skillHeal: 10,
    nullifyTrait: true
  }), state_catalog_cards.C("flameflower", "화락나리", 190, "에너지 보정 지원", "메가리그", "검정 에너지 차단: 필드 중 자기 진영의 2색 이상 무작위 수급에서 B 제외. 고정 수급은 무관.", [state_catalog_cards.S("holyFlame", "성은의불꽃", "RW*", "100-대상 에너지×20D(최소0). 감소량만큼 자신 또는 필드 아군 회복.", "enemyHealAlly", [{
    type: "holyFlame"
  }], ["damage", "heal"])], {
    grade: "3.5☆",
    noBlackGather: true,
    formGroup: "horizon",
    baseFormId: "flameflower",
    formFamilyOrder: ["flameflower", "lunari", "horizintal"]
  }), state_catalog_cards.C("lunari", "루나리", 190, "무작위 에너지·광역 약화", "메가리그", "붉은 에너지 차단: 필드 중 자기 진영의 2색 이상 무작위 수급에서 R을 한 번 제외. 고정 수급은 무관.", [state_catalog_cards.S("lunaShard", "루나샤드", "***", "적 전체. 시작 시 대상별 에너지 수를 고정해 80-에너지×20D(최소 0), 이후 적 진영 공격력 -10.", "field", [{
    type: "lunaShard"
  }], ["damage", "debuff", "field"])], {
    grade: "3.5☆",
    noRedGather: true,
    formGroup: "horizon",
    baseFormId: "flameflower",
    formFamilyOrder: ["flameflower", "lunari", "horizintal"]
  }), state_catalog_cards.C("horizintal", "호리진탈", 250, "수평선 보호·형태 순환", "메가리그", "끝없는 수평선: HP가 최대 이상이면 같은 진영 최종 피해 50% 감소(같은 피해 묶음은 시작 시점 기준, 중첩 없음). 시간의 흐름: 차례 종료 시 HP 절반 이하+W·B 수 다르면 W 우세는 화락나리, B 우세는 루나리로 퇴화.", [state_catalog_cards.S("horizonSun", "호리진썬", "WR*", "40D 후 100D. 두 타격 뒤 화상 2턴.", "enemy", [{
    type: "horizonStrike",
    element: "sun",
    status: "burn"
  }], ["damage", "multi", "status"]), state_catalog_cards.S("horizonMoon", "호리진문", "WB*", "40D 후 100D. 두 타격 뒤 냉동 2턴.", "enemy", [{
    type: "horizonStrike",
    element: "moon",
    status: "freeze"
  }], ["damage", "multi", "status"])], {
    grade: "4☆",
    teamDamageGuardAtFullHp: 0.5,
    horizonFlow: true,
    horizonFlowTargets: {
      W: "flameflower",
      B: "lunari"
    },
    formGroup: "horizon",
    baseFormId: "flameflower",
    formFamilyOrder: ["flameflower", "lunari", "horizintal"]
  }), state_catalog_cards.C("ruby", "루비", 150, "예약 공격 딜러", "메가리그", "없음.", [state_catalog_cards.S("flameWing", "화염날개", "R", "40D. 다음 자기 차례 전까지 상대 공격기술 피해만 무효.", "enemy", [{
    type: "damage",
    amount: 40
  }, {
    type: "flameWing"
  }], ["damage", "guard"]), state_catalog_cards.S("firestorm", "파이어스톰", "R*", "HP90 이하. 즉시 80D+특성봉인2, 다음 자기 차례에 지정한 적 슬롯을 자동 반복 공격.", "enemy", [{
    type: "firestorm"
  }], ["damage", "status", "scheduled"], {
    useWhenHpAtMost: 90
  })], {
    grade: "3.5☆",
    plusStar: {
      skills: {
        firestorm: {
          ignoreUseWhenHpAtMost: true,
          description: "즉시 80D+특성봉인2, 다음 자기 차례에 지정한 적 슬롯을 자동 반복 공격."
        }
      }
    }
  }), state_catalog_cards.C("kingprawn", "왕새우", 220, "대무효 딜러", "메가리그", "없음.", [state_catalog_cards.S("charge", "돌진", "WBR", "120D. 무효 계열 특성을 가진 대상에게 160D.", "enemy", [{
    type: "prawnCharge"
  }], ["damage"])], {
    grade: "3.5☆",
    plusStar: {
      skills: {
        charge: {
          cost: "***"
        }
      }
    }
  }), state_catalog_cards.C("yggdrasil", "이그드라실", 210, "비례 피해·에너지 지원", "메가리그", "생명의 문턱: HP 140 초과→이하 시 필드 전원 에너지 1개 제거, WWWW 획득(전투당 2회). 치유의 빛: 에너지를 정확히 1·3개 얻으면 아군 30 회복(대상 없으면 적 30 피해).", [state_catalog_cards.S("lifeBurst", "라이프버스트", "***", "대상 현재 HP의 33% 피해. 방어와 피해 난수를 적용하지 않는다.", "enemy", [{
    type: "proportionalDamage",
    basis: "current",
    ratio: 0.33
  }], ["damage", "proportional"]), state_catalog_cards.S("firstBurst", "퍼스트버스트", "WWWW", "대상 최대 HP의 33% 피해. 방어·난수 무시. 실질 피해 절반씩 자신과 필드 아군을 회복.", "enemy", [{
    type: "firstBurst"
  }], ["damage", "heal", "proportional"])], {
    grade: "4☆",
    thresholdEnergy: true,
    healingLight: true
  }), state_catalog_cards.C("angel", "천사", 180, "봉인·지속 회복", "메가리그", "이클립스: 첫 출전 상태에서 보유 에너지 수와 보낸 자기 차례 수가 같으면 상대 공격기술 피해를 무효화한다.", [state_catalog_cards.S("lightCandelabra", "빛의촛대", "***", "적: 100D, W 지불 수에 따라 특성/회복/기술 봉인 5턴. 아군: W 수에 따라 총 120 지속 회복.", "anyCharacter", [{
    type: "lightCandelabra"
  }], ["damage", "heal", "status"])], {
    grade: "3.5☆",
    eclipse: true
  }), state_catalog_cards.C("grange", "그랜지", 240, "필드·예약 딜러", "메가리그", "없음.", [state_catalog_cards.S("grandField", "그랜드필드", "WorB WorB", "에너지가 가장 적은 적에게 40D 후 그랜드필드 전개(아군은 W·B 요구 코스트가 *로, 적은 * 요구 코스트가 W 또는 B로 바뀜). 자신과 필드 아군에게 HP 보호막 120. 필드 효과는 하나만 유지되어 새 필드가 기존 필드를 교체하고, 전개한 캐릭터가 후퇴하거나 쓰러지면 끝난다.", "lowestEnergyEnemy", [{
    type: "grandField"
  }], ["damage", "field", "hpProtectionBarrier"]), state_catalog_cards.S("zigzagExcavate", "지그재그굴착", "WBWB", "무적 대기 후 다음 차례에 에너지 적은 적을 가중치로 5회 선택, 대상별 횟수×40D 단일 공격.", "self", [{
    type: "zigzagExcavate"
  }], ["damage", "scheduled"])], {
    grade: "4☆"
  }), state_catalog_cards.C("flappis", "플래피스", 270, "선택형 에너지·예약 딜러", "메가리그", "에너지 직조: 자신 피격 시 W1, 아군 피격 시 W½, 기술 사용 시 R1 획득 여부를 매번 선택. 유연한 몸: 감속 무효.", [state_catalog_cards.S("hurricaneDive", "허리케인 다이브", "W*+", "기본 W* 후 W 추가 지불: 0개 즉시 30D, 1개 1턴 후 100D, 2개 2턴 후 170D. 예약은 적 슬롯 추적.", "enemy", [{
    type: "hurricaneDive"
  }], ["damage", "scheduled", "variableCost"]), state_catalog_cards.S("cottonHeal", "코튼힐", "R*", "적에게 감속2, 자신 HP30 회복.", "enemy", [{
    type: "status",
    status: "slow",
    duration: 2
  }, {
    type: "selfHeal",
    amount: 30
  }], ["heal", "status"], {
    aiProfile: {
      kind: "selfHealStatusHit",
      selfHeal: 30,
      status: "slow",
      duration: 2
    },
    runtimeKind: "selfHealStatusHit"
  })], {
    grade: "4☆",
    slowImmune: true,
    selectiveEnergyTrait: true,
    traitEnergyOnHit: {
      self: {
        color: "W",
        amount: 1
      },
      ally: {
        color: "W",
        amount: 0.5
      }
    }
  }), state_catalog_cards.C("eterna", "이터너", 230, "교체 봉쇄·R 연계", "메가리그", "상대 교체 불가: 생존·특성 활성 중 상대의 자발적 교체를 막음. 사망 슬롯 출전은 허용.", [state_catalog_cards.S("suctionPad", "흡착 발판", "", "자신·아군·적 필드 캐릭터 하나에게 R 1을 부여. 자신 또는 아군 대상이면 비공격 피해 20D.", "anyCharacter", [{
    type: "suctionPad"
  }], ["energy", "support"], {
    nonAttack: true
  }), state_catalog_cards.S("eternaHeal", "이터너힐", "R*", "대상 R 수×60D 후 R 전부 제거, 실질 피해 절반을 필드 아군에 나눠 회복. 자신·필드 아군에 R 1 부여.", "enemy", [{
    type: "eternaHeal"
  }], ["damage", "heal", "energy"])], {
    grade: "4☆",
    releaseOrder: 10,
    tags: ["deepsea-family"],
    switchLockTrait: true
  }), state_catalog_cards.C("toxious", "톡시어스", 170, "실드 전환·광역 폭발", "메가리그", "", [state_catalog_cards.S("unseal", "봉인 해제", "", "현재 실드가 있을 때만 사용. 실드 전부 파괴 후 비공격 자기 피해 20D, R 3개를 순차 획득.", "self", [{
    type: "toxiousUnseal"
  }], ["energy", "shield"], {
    nonAttack: true,
    requirements: {
      minShield: 1
    }
  }), state_catalog_cards.S("groundZero", "그라운드제로", "RRR", "주 대상 140D. 다른 살아 있는 적 필드 캐릭터가 있으면 70D 후 화상 4턴.", "enemy", [{
    type: "groundZero"
  }], ["damage", "status"]), state_catalog_cards.S("dustWave", "더스트웨이브", "BBR", "100D.", "enemy", [{
    type: "dustWave"
  }], ["damage"])], {
    grade: "4☆",
    shield: 50,
    traits: [],
    releaseOrder: 11,
    tags: ["legendary-dragon", "dragon"]
  }), state_catalog_cards.C("abigate", "아비게이트", 260, "가변 저주·에너지 교환", "메가리그", "다운 프레셔: 상대 독 추가 코스트 *를 B로 고정. 딥마인드: 자신·아군 비공격기 사용 후 대상 HP 10 회복, 상대 필드 에너지 0.5 제거.", [state_catalog_cards.S("abyssCannon", "초저주포", "****-", "에너지 0~4개 선택 지불: 4/3/2/1/0개에 100/60/20/0/0D. R·W·B가 모두 지불되면 독 3턴.", "enemy", [{
    type: "abyssCannon"
  }], ["damage", "status", "variableCost"]), state_catalog_cards.S("abyssVortex", "심해의소용돌이", "B", "서로 다른 필드 캐릭터 둘의 에너지 슬롯 색만 원하는 만큼 교환. 에너지 양·소유자 유지.", "self", [{
    type: "abyssVortex"
  }], ["energy", "support"], {
    nonAttack: true
  })], {
    grade: "4☆",
    releaseOrder: 12,
    tags: ["deepsea-family"],
    downPressure: true,
    deepMind: true
  }), state_catalog_cards.C("jungles", "정글즈", 270, "소환·에너지 강탈", "메가리그", "재생력: 특성봉인이 아니면 차례 종료 시 상태이상 지속 -2. 정글진흙: 직접 에너지 모으기는 B만 획득.", [state_catalog_cards.S("vineWhip", "덩굴휩", "*", "20D. 이후 W½ 획득. 전투 첫 사용 또는 상태이상 중이면 대상의 최근 에너지를 강탈.", "enemy", [{
    type: "junglesVineWhip"
  }], ["damage", "energy"]), state_catalog_cards.S("summonToucan", "왕부리새", "W*", "왕부리새 소환. HP60, 힐링윙(*)과 쪼아먹기(B*) 사용.", "self", [{
    type: "summonToucan"
  }], ["summon"], {
    nonAttack: true
  }), state_catalog_cards.S("summonAnaconda", "아나콘다", "WW*", "아나콘다 소환. HP120, 조이기(R) 70D 후 잔여 에너지 기반 방해.", "self", [{
    type: "summonAnaconda"
  }], ["summon"], {
    nonAttack: true
  }), state_catalog_cards.S("summonJaguar", "재규어", "RW**", "재규어 소환. HP160, 최근 아군 사망 수에 따라 분노발톱 강화.", "self", [{
    type: "summonJaguar"
  }], ["summon"], {
    nonAttack: true
  })], {
    grade: "4☆",
    speed: 1,
    releaseOrder: 13,
    tags: ["jungle"],
    regenerationTrait: true,
    jungleMud: true
  }), state_catalog_cards.C("jetski", "제트스키", 140, "고속 예약 딜러", "메가리그", "없음.", [state_catalog_cards.S("jetskiBoost", "가속", "**", "40D. 다음 자기 차례의 모든 기술 코스트를 오른쪽에서부터 1 감소.", "enemy", [{
    type: "damage",
    amount: 40
  }, {
    type: "queuedSkillCostReduction",
    amount: 1
  }], ["damage", "tempo"], {
    vfxTheme: "jetskiBoost"
  }), state_catalog_cards.S("waterBite", "물어뜯기", "BB", "80D.", "enemy", [{
    type: "damage",
    amount: 80
  }], ["damage"], {
    vfxTheme: "waterBite"
  }), state_catalog_cards.S("jetskiDive", "다이브", "B", "1턴간 무적 후 70D.", "enemy", [{
    type: "delayedAttack",
    amount: 70,
    invulnerable: true
  }], ["damage", "scheduled"], {
    vfxTheme: "jetskiDive"
  })], {
    grade: "2☆",
    speed: 1,
    league: "mega",
    releaseOrder: 15,
    tags: ["water", "speed"]
  }), state_catalog_cards.C("aquamarine", "아쿠아마린", 180, "수류 제어 딜러", "메가리그", "HP가 가득 차 있을 때 받는 피해 절반.", [state_catalog_cards.S("waterSplash", "물벼락", "*", "30D.", "enemy", [{
    type: "damage",
    amount: 30
  }], ["damage"], {
    vfxTheme: "waterSplash"
  }), state_catalog_cards.S("whirlpool", "회오리", "B+", "30D. 기본 B 외에 추가 투입한 에너지 수×30HP 회복.", "enemy", [{
    type: "damage",
    amount: 30
  }, {
    type: "extraEnergyHeal",
    amountPerEnergy: 30
  }], ["damage", "heal", "variableCost"], {
    vfxTheme: "whirlpool",
    extraAnyEnergy: true
  }), state_catalog_cards.S("waveRideAqua", "파도타기", "WB", "80D.", "enemy", [{
    type: "damage",
    amount: 80
  }], ["damage"], {
    vfxTheme: "waveRide"
  }), state_catalog_cards.S("aquaTornado", "토네이도", "BB**", "90D. 대상의 방어 증감 영향을 2배로 받는다. 피해 후 대상의 공격·방어 -10.", "enemy", [{
    type: "damage",
    amount: 90,
    defenseModMultiplier: 2
  }, {
    type: "attackMod",
    amount: -10
  }, {
    type: "defenseMod",
    amount: -10
  }], ["damage", "debuff"], {
    vfxTheme: "aquaTornado"
  }), state_catalog_cards.S("toweringSplash", "타워링 스플래시", "WW**", "60D. 적 에너지 1개 분량 제거 + 자신의 방어 +20.", "enemy", [{
    type: "damage",
    amount: 60
  }, {
    type: "removeEnergyAmount",
    amount: 1
  }, {
    type: "defenseMod",
    amount: 20,
    target: "self"
  }], ["damage", "energy", "defense"], {
    vfxTheme: "toweringSplash"
  })], {
    grade: "3.5☆",
    league: "mega",
    releaseOrder: 16,
    tags: ["water"],
    fullHpDamageMultiplier: 0.5
  }), state_catalog_cards.C("galewing", "질풍날개", 110, "고속 처형 딜러", "메가리그", "없음.", [state_catalog_cards.S("galeSlash", "일발가르기", "", "30D. 반동피해 30. 대상 HP가 1/4 이하이면 크리티컬.", "enemy", [{
    type: "thresholdCritical",
    amount: 30,
    threshold: 0.25,
    recoil: 30
  }], ["damage", "critical"], {
    vfxTheme: "galeSlash"
  }), state_catalog_cards.S("galeGlide", "활공", "**", "1턴간 무적 후 60D.", "enemy", [{
    type: "delayedAttack",
    amount: 60,
    invulnerable: true
  }], ["damage", "scheduled"], {
    vfxTheme: "galeGlide"
  })], {
    grade: "2☆",
    speed: 1,
    league: "mega",
    releaseOrder: 17,
    tags: ["wind", "speed"]
  }), state_catalog_cards.C("axshrimp", "도끼새우", 140, "변환 결제 처형 딜러", "메가리그", "기술 사용 시 W 에너지를 원하는 만큼 R 또는 B로 바꿔서 지불할 수 있다.", [state_catalog_cards.S("poisonTail", "포이즌테일", "B*", "60D. 1/2 확률로 독.", "enemy", [{
    type: "damage",
    amount: 60
  }, {
    type: "statusChance",
    status: "poison",
    duration: 1,
    chance: 0.5
  }], ["damage", "status"], {
    vfxTheme: "poisonTail"
  }), state_catalog_cards.S("axeChop", "도끼질", "RRR", "110D. 크리티컬 50%. 적이 버텼다면 이 기술은 실패한다.", "enemy", [{
    type: "allOrNothingCritical",
    amount: 110,
    criticalChance: 0.5
  }], ["damage", "critical"], {
    vfxTheme: "axeChop"
  })], {
    grade: "3☆",
    speed: 1,
    league: "mega",
    releaseOrder: 18,
    tags: ["poison"],
    flexibleSkillPaymentW: true
  }), state_catalog_cards.C("heroncaptain", "백로선장", 190, "빙결 연계 딜러", "메가리그", "없음.", [state_catalog_cards.S("captainSurf", "파도타기", "WB", "80D.", "enemy", [{
    type: "damage",
    amount: 80
  }], ["damage"], {
    vfxTheme: "captainSurf"
  }), state_catalog_cards.S("iceWing", "얼음날개", "W", "30D. 다음 자기 차례 시작 전까지 무적.", "enemy", [{
    type: "damage",
    amount: 30
  }, {
    type: "fullInvulnerableUntilOwnTurn"
  }], ["damage", "defense"], {
    vfxTheme: "iceWing"
  }), state_catalog_cards.S("freezeBeam", "냉동빔", "W", "30D. 이전 자기 차례에도 냉동빔을 사용했다면 코스트가 *로 변하고, 명중 후 대상을 1턴 냉동.", "enemy", [{
    type: "damage",
    amount: 30
  }, {
    type: "repeatStatus",
    previousSkill: "freezeBeam",
    status: "freeze",
    duration: 1
  }], ["damage", "status"], {
    vfxTheme: "freezeBeam",
    repeatCost: "*"
  })], {
    grade: "3☆",
    league: "mega",
    releaseOrder: 19,
    tags: ["water", "ice"]
  }), state_catalog_cards.C("shuvi", "슈비", 110, "초고속 교란 지원", "메가리그", "공격을 1/3 확률로 회피. 능력치 감소 무효.", [state_catalog_cards.S("bloodSuck", "흡혈", "**", "적에게 독1·마비1을 부여하고 자신의 공격 +10, HP 30 회복.", "enemy", [{
    type: "status",
    status: "poison",
    duration: 1
  }, {
    type: "status",
    status: "paralyze",
    duration: 1
  }, {
    type: "attackMod",
    amount: 10,
    target: "self"
  }, {
    type: "selfHeal",
    amount: 30
  }], ["status", "heal", "buff"], {
    vfxTheme: "bloodSuck"
  }), state_catalog_cards.S("shuviGlide", "활공", "**", "1턴간 무적 후 80D.", "enemy", [{
    type: "delayedAttack",
    amount: 80,
    invulnerable: true
  }], ["damage", "scheduled"], {
    vfxTheme: "shuviGlide"
  })], {
    grade: "3☆",
    speed: 3,
    league: "mega",
    releaseOrder: 20,
    tags: ["wind", "poison"],
    attackEvasionChance: 1 / 3,
    statDecreaseImmune: true
  }), state_catalog_cards.C("phantomMuner", "괴도무너", 170, "상태 면역·약탈 딜러", "메가리그", "상태이상 무효.", [state_catalog_cards.S("wingCutter", "윙커터", "**", "50D.", "enemy", [{
    type: "damage",
    amount: 50
  }], ["damage"], {
    vfxTheme: "galeSlash"
  }), state_catalog_cards.S("plunderAmbush", "약탈기습", "BBR", "100D. 대상의 원하는 에너지 하나를 골라 강탈.", "enemy", [{
    type: "damage",
    amount: 100
  }, {
    type: "selectedEnergyTransfer",
    count: 1
  }], ["damage", "energy"], {
    interaction: {
      kind: "targetEnergyTransfer",
      count: 1
    },
    vfxTheme: "captainSurf"
  }), state_catalog_cards.S("iceShot", "아이스샷", "BR", "30D씩 무작위 2~4회.", "enemy", [{
    type: "randomMultiHit",
    amount: 30
  }], ["damage", "multi"], {
    hitRange: [2, 4],
    vfxTheme: "freezeBeam"
  })], {
    grade: "3☆",
    immunities: ["poison", "slow", "paralyze", "burn", "freeze", "traitSeal", "skillSeal", "healSeal"]
  }), state_catalog_cards.C("magSnail", "마그달팽", 120, "필드 전개 포격", "메가리그", "없음.", [state_catalog_cards.S("catapult", "투석기", "B", "20D.", "enemy", [{
    type: "damage",
    amount: 20
  }], ["damage"]), state_catalog_cards.S("steamHeater", "스팀히터", "WR", "80D. 그랜드필드가 없다면 피해량은 0이 되고 그랜드필드를 전개(아군은 W·B 요구 코스트가 *로, 적은 * 요구 코스트가 W 또는 B로 바뀜). 필드 효과는 하나만 유지되어 새 필드가 기존 필드를 교체하고, 전개한 캐릭터가 후퇴하거나 쓰러지면 끝난다.", "enemy", [{
    type: "grandField",
    damageWhenPresent: 80,
    damageWhenMissing: 0,
    barrierAmount: 0,
    onlyIfMissing: true
  }], ["damage", "field"], {
    vfxTheme: "toweringSplash"
  })], {
    grade: "3☆",
    speed: -1,
    shield: 100
  }), state_catalog_cards.C("thornJellyfish", "가시해파리", 100, "상태이상 견제", "메가리그", "없음.", [state_catalog_cards.S("boltWeb", "볼트웹", "WR", "50D. 마비 2턴.", "enemy", [{
    type: "damage",
    amount: 50
  }, {
    type: "status",
    status: "paralyze",
    duration: 2
  }], ["damage", "status"], {
    vfxTheme: "jetskiBoost"
  }), state_catalog_cards.S("bubbleBeam", "버블빔", "**", "30D. 감속 2턴.", "enemy", [{
    type: "damage",
    amount: 30
  }, {
    type: "status",
    status: "slow",
    duration: 2
  }], ["damage", "status"], {
    vfxTheme: "waterSplash"
  })], {
    grade: "2☆",
    shield: 30
  }), state_catalog_cards.C("sunflower", "해바라기", 110, "흡수 딜러", "메가리그", "없음.", [state_catalog_cards.S("parasiteBloom", "기생초", "W*", "60D. 준 피해량의 50%를 흡수(10단위).", "enemy", [{
    type: "damage",
    amount: 60,
    absorbFraction: 0.5
  }], ["damage", "heal"], {
    vfxTheme: "bloodSuck"
  }), state_catalog_cards.S("holyLight", "성스러운빛", "*+", "대상의 상태이상을 모두 해제한 뒤, 추가로 투입한 W 에너지 1개당 50D.", "enemy", [{
    type: "holyLight",
    perWhite: 50
  }], ["damage", "status", "variableCost"], {
    extraAnyEnergy: true,
    extraEnergyColor: "W"
  })], {
    grade: "2☆"
  }), state_catalog_cards.C("megaWing", "메가윙", 60, "초고속 약탈 딜러", "메가리그", "없음.", [state_catalog_cards.S("megaGlide", "메가글라이드", "WW", "80D. 실드가 있을 때만 사용. 대상의 원하는 에너지 하나를 골라 강탈.", "enemy", [{
    type: "damage",
    amount: 80
  }, {
    type: "selectedEnergyTransfer",
    count: 1
  }], ["damage", "energy"], {
    requirements: {
      minShield: 1
    },
    interaction: {
      kind: "targetEnergyTransfer",
      count: 1
    },
    vfxTheme: "galeGlide"
  }), state_catalog_cards.S("bodyTackle", "몸통박치기", "**", "30D.", "enemy", [{
    type: "damage",
    amount: 30
  }], ["damage"])], {
    grade: "2☆",
    speed: 3,
    shield: 60
  }), state_catalog_cards.C("tube", "튜브", 160, "충격 반격 딜러", "메가리그", "없음.", [state_catalog_cards.S("wave", "파도", "B*", "70D.", "enemy", [{
    type: "damage",
    amount: 70
  }], ["damage"], {
    vfxTheme: "waveRide"
  }), state_catalog_cards.S("tornadoSplash", "토네이도 스플래시", "BB**", "30×(1~6)D 무작위 피해.", "enemy", [{
    type: "randomScaledDamage",
    amount: 30,
    minMultiplier: 1,
    maxMultiplier: 6
  }], ["damage"], {
    vfxTheme: "aquaTornado"
  }), state_catalog_cards.S("shockwave", "충격파", "B**", "자신의 이전 차례 끝 HP와 지금 HP의 차이만큼 피해. 지금 HP가 그때보다 높거나 같으면 0D. 출전한 뒤 첫 차례 전에는 출전 시점의 HP가 기준.", "enemy", [{
    type: "hpLossBlast"
  }], ["damage"], {
    vfxTheme: "toweringSplash"
  })], {
    grade: "2☆",
    league: "mega",
    tags: ["water"]
  }), state_catalog_cards.C("bush", "덤불", 190, "방어 지원·상태이상 연사", "메가리그", "HP가 190 이상일 때 받는 공격 피해가 크리티컬이 된다(150%, 공격자에게 불리한 공격·방어 수치는 무시).", [state_catalog_cards.S("guard", "막기", "*", "자신의 HP 50을 소모해 아군 하나에게 실드 50.", "ally", [{
    type: "selfDamage",
    amount: 50
  }, {
    type: "shield",
    amount: 50
  }], ["shield"]), state_catalog_cards.S("triple", "트리플", "*****", "30D씩 3회. 각 공격마다 33%로 냉동·마비 2턴, 방어 -10 중 하나를 건다.", "enemy", [{
    type: "orbVolley",
    amount: 30,
    hits: 3,
    chance: 0.33,
    outcomes: [{
      kind: "freeze",
      status: "freeze",
      duration: 2
    }, {
      kind: "paralyze",
      status: "paralyze",
      duration: 2
    }, {
      kind: "defense",
      defense: -10
    }]
  }], ["damage", "multi", "status"])], {
    grade: "2☆",
    speed: -1,
    maxEnergy: 5,
    league: "mega",
    critTakenAtHp: 190,
    tags: ["grass"]
  }), state_catalog_cards.C("helmetShark", "투구상어", 130, "실드 형태 전환 딜러", "메가리그", "실드가 있을 때는 드래곤의 모습, 없을 때는 상어의 모습이다. 모습에 따라 사용할 수 있는 기술이 다르다.", [state_catalog_cards.S("whirl", "회오리", "R", "40D.", "enemy", [{
    type: "damage",
    amount: 40
  }], ["damage"], {
    requirements: {
      shield: "present",
      traitBound: true
    }
  }), state_catalog_cards.S("dragonRush", "드래곤러시", "***", "120D. 자신도 1/3의 반동 피해를 받는다.", "enemy", [{
    type: "damage",
    amount: 120,
    recoilFraction: 1 / 3
  }], ["damage"], {
    requirements: {
      shield: "absent",
      traitBound: true
    }
  })], {
    grade: "2☆",
    shield: 30,
    league: "mega",
    tags: ["water", "dragon"]
  }), state_catalog_cards.C("snakeArmor", "뱀비늘갑옷", 70, "방어형 독 딜러", "메가리그", "기본 방어 10. 실드가 없을 때 공격이 10 오른다.", [state_catalog_cards.S("poisonTail", "포이즌테일", "B**", "70D. 50%로 독.", "enemy", [{
    type: "damage",
    amount: 70
  }, {
    type: "statusChance",
    status: "poison",
    duration: 2,
    chance: 0.5
  }], ["damage", "status"]), state_catalog_cards.S("dig", "굴착", "WR", "80D. 자신에게 감속 및 방어력 10 상승.", "enemy", [{
    type: "damage",
    amount: 80
  }, {
    type: "status",
    status: "slow",
    duration: 2,
    target: "self"
  }, {
    type: "defenseMod",
    amount: 10,
    target: "self"
  }], ["damage", "status", "defense"])], {
    grade: "2☆",
    speed: -1,
    shield: 40,
    baseDefense: 10,
    noShieldAttackBonus: 10,
    league: "mega",
    tags: ["poison"]
  }), state_catalog_cards.C("sandcastle", "모래성", 140, "에너지 교란·보호막 지원", "메가리그", "없음.", [state_catalog_cards.S("sandWind", "모래바람", "W", "30D. 대상의 에너지를 모두 하얀색으로.", "enemy", [{
    type: "damage",
    amount: 30
  }, {
    type: "colorAll",
    color: "W"
  }], ["damage", "energy"]), state_catalog_cards.S("sandWall", "방벽", "**", "원하는 대상에게 HP 보호막 100(40씩 감소).", "ally", [{
    type: "hpBarrier",
    amount: 100,
    decayPerTurn: 40
  }], ["shield"]), state_catalog_cards.S("sandQuake", "지진", "WW WorB *", "120D. 대상과 자신의 모든 에너지를 제거.", "enemy", [{
    type: "damage",
    amount: 120
  }, {
    type: "removeAllEnergy"
  }, {
    type: "removeAllEnergy",
    target: "self"
  }], ["damage", "energy"])], {
    grade: "2☆",
    league: "mega",
    tags: ["earth"]
  }), state_catalog_cards.C("frost", "프로스트", 110, "냉동 견제", "메가리그", "냉동 흡수: 냉동 적용을 무효화하고 W 2개를 얻는다. 냉동에 걸린 적이 차례를 시작할 때 20 피해.", [state_catalog_cards.S("snowBreath", "눈꽃숨", "W", "30D. 대상의 에너지 하나를 오른쪽부터 제거.", "enemy", [{
    type: "damage",
    amount: 30
  }, {
    type: "removeEnergy",
    amount: 1,
    recent: true
  }], ["damage", "energy"]), state_catalog_cards.S("frostbind", "프로스트", "W", "대상에게 에너지가 가득 찰 때까지 지속되는 냉동.", "enemy", [{
    type: "freezeUntilFull"
  }], ["status"], {
    vfxTheme: "freezeBeam"
  })], {
    grade: "2☆",
    league: "mega",
    tags: ["ice"],
    freezeAbsorb: true,
    freezeAbsorbEnergy: {
      color: "W",
      amount: 2
    },
    frozenTurnStartDamage: 20
  }), state_catalog_cards.C("circuit", "서킷", 170, "연속 행동·전류 방어", "메가리그", "프레그먼트: R+B 총량×10 방어, 외부 에너지 조작 차단. 전류가속: 기본 차례 시작 시 완성 W 수만큼 추가 차례. 교류충전·마비 무효.", [state_catalog_cards.S("roundKick", "돌려차기", "**", "적 필드 전체 각각 30D.", "self", [{
    type: "circuitRoundKick"
  }], ["damage", "multi"]), state_catalog_cards.S("armsBlade", "암즈블레이드", "WW", "대상 최대 HP 25% 피해 후 생존 시 마비1. 이후 B와 R을 1개씩 획득.", "enemy", [{
    type: "circuitArmsBlade"
  }], ["damage", "status", "energy"]), state_catalog_cards.S("voltageBurst", "볼티지버스트", "", "완성 W 수에 따라 연속 행동으로 준비. 성공 시 W 전부 제거 후 m²×15D, B를 m만큼 획득.", "enemy", [{
    type: "circuitVoltageBurst"
  }], ["damage", "scheduled"])], {
    grade: "4☆",
    speed: 2,
    releaseOrder: 14,
    tags: ["electric"],
    fragmentTrait: true,
    currentAcceleration: true,
    alternatingCharge: true,
    paralyzeImmune: true
  })];
  state_catalog_cards.BASE_IDS = state_catalog_cards.CARDS.filter(c => c.grade === "2☆" && c.league !== "mega").map(c => c.id);
  state_catalog_cards.TWO_STAR_IDS = [...state_catalog_cards.BASE_IDS];
  state_catalog_cards.MEGA_IDS = state_catalog_cards.CARDS.filter(c => c.league === "mega").map(c => c.id);
  state_catalog_cards.SPECIAL_IDS = [];
  state_catalog_cards.PLUS_STAR_ELIGIBLE = Object.freeze(new Set(state_catalog_cards.CARDS.filter(c => c.plusStar).map(c => c.id)));
  state_catalog_cards.PlusStarModifierOwner = Object.freeze({
    eligible: ref => !!card(ref)?.plusStar,
    active: unit => !!unit?.plusStar && !!card(unit)?.plusStar,
    skillModifier(unit, skill) {
      if (!this.active(unit) || !skill?.id) return null;
      return card(unit)?.plusStar?.skills?.[skill.id] || null;
    },
    grade(cardRef, unit = null) {
      return state_catalog_cards.EffectiveCardPresentationOwner.resolve(cardRef, unit).rarity;
    },
    name(cardRef, unit = null) {
      return state_catalog_cards.EffectiveCardPresentationOwner.resolve(cardRef, unit).displayName;
    },
    cost(unit, skill, fallback = "") {
      const mod = this.skillModifier(unit, skill);
      return String(mod?.cost ?? fallback ?? skill?.cost ?? "");
    },
    target(unit, skill) {
      const mod = this.skillModifier(unit, skill);
      return mod?.target || skill?.target || "enemy";
    },
    hitRange(unit, skill) {
      const mod = this.skillModifier(unit, skill);
      if (Array.isArray(mod?.hitRange)) return [...mod.hitRange];
      if (Array.isArray(skill?.hitRange)) return [...skill.hitRange];
      return null;
    },
    actionSpec(g, teamId, slotIndex, unit, skill, action = null, targets = []) {
      const targetShape = this.target(unit, skill);
      const modifier = this.skillModifier(unit, skill);
      const canonicalTargets = [...new Map((targets || []).filter(Boolean).map(target => [String(target.uid || `${target.team}:${target.slot}`), target])).values()];
      const targetSlots = canonicalTargets.map(target => Object.freeze({
        team: target.team || other(teamId),
        slot: Number(target.slot),
        uid: target.uid || null
      }));
      const actionId = String(action?.actionId || action?.commandId || `${g?.battleId || g?.matchId || g?.seed || "battle"}:${g?.turnSerial || 0}:${unit?.uid || "source"}:${skill?.id || "skill"}`);
      return Object.freeze({
        baseSkillId: skill?.id || null,
        sourceInstanceId: unit?.uid || null,
        sourceTeam: teamId,
        sourceSlot: Number(slotIndex),
        deckSlotId: unit?.deckSlotId || unit?.compositionSlotId || `${teamId}:${slotIndex}`,
        plusStar: this.active(unit),
        effectiveCost: this.cost(unit, skill, action?.costOverride ?? skill?.cost ?? ""),
        effectiveTargetShape: targetShape,
        effectiveLegality: this.legal(unit, skill),
        effectiveHitRange: this.hitRange(unit, skill),
        effectiveFollowUpPolicy: modifier?.followUpPolicy || skill?.followUpPolicy || null,
        targetSnapshotPolicy: targetShape === "enemyField" ? "field-slots-at-action-resolution" : "selected-slot",
        targetInstanceIds: Object.freeze(canonicalTargets.map(target => String(target.uid)).filter(Boolean)),
        targetSlots: Object.freeze(targetSlots),
        actionId,
        transactionId: String(action?.transactionId || action?.commandId || actionId)
      });
    },
    description(unit, skill) {
      const mod = this.skillModifier(unit, skill);
      return String(mod?.description ?? skill?.desc ?? "");
    },
    viewModel(cardRef, unit = null) {
      const vm = state_catalog_cards.EffectiveCardPresentationOwner.resolve(cardRef, unit);
      return Object.freeze({
        cardId: vm.effectiveCharacterId,
        plusStar: vm.plusStar,
        name: vm.displayName,
        grade: vm.rarity,
        skills: vm.skills
      });
    },
    legal(unit, skill) {
      if (!skill) return true;
      const mod = this.skillModifier(unit, skill);
      if (Number.isFinite(Number(skill.useWhenHpAtMost)) && Number(unit?.hp) > Number(skill.useWhenHpAtMost)) return !!mod?.ignoreUseWhenHpAtMost;
      return true;
    }
  });
  state_catalog_cards.EffectiveCardPresentationOwner = Object.freeze({
    skillDescription(unit, skill) {
      if (!skill) return "";
      return state_catalog_cards.PlusStarModifierOwner.description(unit, skill);
    },
    syntheticUnit(cardRef, context = {}) {
      const def = card(cardRef),
        deck = Array.isArray(context.deck) ? context.deck : null;
      const explicit = Number(context.slotIndex);
      const slotIndex = Number.isInteger(explicit) && explicit >= 0 ? explicit : deck ? deck.indexOf(def.id) : -1;
      const team = String(context.team || "P");
      const resolved = deck ? resolvePlusStarChoice(context.plusStarChoice, deck, team) : null;
      const plusStar = !!resolved && resolved.slotIndex === slotIndex && resolved.cardId === def.id;
      return Object.freeze({
        card: def.id,
        name: def.name,
        plusStar,
        deckSlotId: slotIndex >= 0 ? `${team}:${slotIndex}` : null,
        compositionSlotId: slotIndex >= 0 ? `${team}:${slotIndex}` : null,
        presentationOnly: true
      });
    },
    syntheticUnitFromAnchor(anchor, cardRef) {
      if (!anchor || !cardRef) return null;
      const def = card(cardRef),
        surface = String(anchor.dataset.infoSurface || anchor.dataset.infoCard || ""),
        team = String(anchor.dataset.infoTeam || "P");
      let deck = null,
        plusStarChoice = null;
      if (["local-composition", "ai-composition", "online-lobby", "host-lobby", "guest-lobby"].includes(surface)) {
        deck = state_ui_battle_state.selected;
        plusStarChoice = state_ui_deck.plusStarSelection;
      } else if (["boss-composition", "boss-coop", "boss-coop-host", "boss-coop-guest"].includes(surface)) {
        const bossContext = systems.__redTimeoraBossRaid?.presentationContext?.() || null;
        deck = bossContext?.deck || null;
        plusStarChoice = bossContext?.plusStar || null;
      } else if (surface === "online-remote-lobby") {
        deck = state_ui_deck.p2p?.remoteDeck || [];
        plusStarChoice = state_ui_deck.p2p?.remotePlusStar || null;
      } else if (surface === "boss-coop-remote") {
        deck = state_ui_deck.p2p?.bossRemoteDeck || [];
        plusStarChoice = state_ui_deck.p2p?.bossRemotePlusStar || null;
      }
      if (!Array.isArray(deck)) return Object.freeze({
        card: def.id,
        name: def.name,
        plusStar: false,
        deckSlotId: null,
        presentationOnly: true
      });
      return this.syntheticUnit(def, {
        deck,
        plusStarChoice,
        team,
        slotIndex: Number(anchor.dataset.infoSlotIndex),
        surface
      });
    },
    resolve(cardRef, unit = null, context = {}) {
      const def = unit?.card ? card(unit) : card(cardRef);
      const effectiveUnit = unit || this.syntheticUnit(def, context);
      const plusStar = state_catalog_cards.PlusStarModifierOwner.active(effectiveUnit);
      const rawRarity = String(def.grade || "0☆"),
        rarityNumber = Number.parseFloat(rawRarity);
      const displayName = `${String(def.name || effectiveUnit?.name || "").replace(/\++$/g, "")}${plusStar ? "+" : ""}`;
      const rarity = plusStar && Number.isFinite(rarityNumber) ? `${rarityNumber + 0.5}☆` : rawRarity;
      const skills = Object.freeze((def.skills || []).map(skill => Object.freeze({
        id: skill.id,
        name: skill.name,
        cost: state_catalog_cards.PlusStarModifierOwner.cost(effectiveUnit, skill, skill.cost),
        target: state_catalog_cards.PlusStarModifierOwner.target(effectiveUnit, skill),
        description: this.skillDescription(effectiveUnit, skill)
      })));
      const deckSlot = effectiveUnit?.deckSlotId || effectiveUnit?.compositionSlotId || context.deckSlotId || null;
      const visualClasses = Object.freeze(plusStar ? ["plusstar-active-banner"] : []);
      return Object.freeze({
        exactInstanceId: effectiveUnit?.uid || effectiveUnit?.entityId || null,
        exactDeckSlot: deckSlot,
        baseCharacterId: def.baseFormId || def.id,
        effectiveCharacterId: def.id,
        formId: def.formGroup ? def.id : null,
        plusStar,
        displayName,
        glyph: typeof cardEmoji === "function" ? cardEmoji(def.id) : "",
        rarity,
        maxHP: Number(effectiveUnit?.maxHp ?? def.maxHp ?? 0),
        currentHP: effectiveUnit?.hp == null ? null : Number(effectiveUnit.hp),
        speed: Number(effectiveUnit?.speed ?? def.speed ?? 0),
        shield: Number(effectiveUnit?.shield ?? def.shield ?? 0),
        traitDescription: def.traitRules ? def.traitRules.filter(rule => !rule.consumedField || !effectiveUnit?.[rule.consumedField]).map(rule => rule.description).join(' ') : String(def.trait || ""),
        skills,
        visualModifiers: Object.freeze({
          plusStarGlow: plusStar,
          glowClass: plusStar ? "plusstar-active-banner" : "",
          classes: visualClasses
        }),
        plusStarControl: Object.freeze({
          eligible: state_catalog_cards.PlusStarModifierOwner.eligible(def),
          active: plusStar,
          deckSlot
        }),
        formControl: Object.freeze({
          group: def.formGroup || null,
          current: def.id,
          next: null
        }),
        sourceRevision: Number(context.sourceRevision ?? (typeof state_ui_battle_state.game !== "undefined" ? state_ui_battle_state.game?.networkRevision : 0) ?? 0),
        contextIdentity: String(context.contextIdentity || context.surface || "presentation"),
        unit: effectiveUnit
      });
    },
    skill(unit, skill) {
      const def = card(unit),
        vm = this.resolve(def, unit);
      return vm.skills.find(candidate => candidate.id === skill?.id) || Object.freeze({
        id: skill?.id || null,
        name: skill?.name || "",
        cost: skill?.cost || "",
        target: skill?.target || "enemy",
        description: this.skillDescription(unit, skill)
      });
    },
    syncElement(element, viewModel) {
      if (!element || !viewModel) return false;
      element.classList.toggle("plusstar-active-banner", !!viewModel.visualModifiers.plusStarGlow);
      element.dataset.effectiveCharacterId = viewModel.effectiveCharacterId;
      element.dataset.effectivePlusStar = String(!!viewModel.plusStar);
      if (viewModel.exactDeckSlot) element.dataset.effectiveDeckSlot = viewModel.exactDeckSlot;else delete element.dataset.effectiveDeckSlot;
      return true;
    }
  });
  state_catalog_cards.FormFamilyOwner = Object.freeze({
    groups() {
      return [...new Set(state_catalog_cards.CARDS.map(c => c.formGroup).filter(Boolean))];
    },
    members(group) {
      if (!group) return [];
      const members = state_catalog_cards.CARDS.filter(c => c.formGroup === group);
      const explicit = members.map(c => c.formFamilyOrder).find(Array.isArray);
      return [...(explicit || members.map(c => c.id))].filter(id => state_catalog_cards.CARDS.some(c => c.id === id));
    },
    group(ref) {
      return card(ref)?.formGroup || null;
    },
    next(ref) {
      const id = typeof ref === "string" ? ref : ref?.card || ref?.id;
      const list = this.members(this.group(id));
      if (!list.length) return null;
      const index = Math.max(0, list.indexOf(id));
      return list[(index + 1) % list.length];
    },
    transition(g, unit, targetId, reason = "형태 전환") {
      if (!unit || unit.dead) return false;
      const from = card(unit),
        to = card(targetId);
      if (!to?.id || !from?.formGroup || from.formGroup !== to.formGroup) return false;
      const hp = Number(unit.hp || 0),
        oldMax = Number(unit.maxHp || from.maxHp || 0);
      unit.card = to.id;
      unit.name = state_catalog_cards.EffectiveCardPresentationOwner.resolve(to, unit, {
        surface: "form-transition",
        sourceRevision: g?.networkRevision || 0
      }).displayName;
      unit.maxHp = Number(to.maxHp || oldMax);
      unit.hp = Math.min(hp, unit.maxHp);
      unit.baseDefense = Number(to.baseDefense || 0);
      unit.defense = unit.baseDefense + Number(unit.defenseMod || 0);
      if (Number(unit.hp) !== hp && g) log(g, `${reason}: HP ${hp} → ${unit.hp} (최대 HP clamp).`);
      if (g) {
        log(g, `${from.name} → ${to.name}: ${reason}.`);
        queueVisual(g, {
          type: "formTransition",
          uid: unit.uid,
          from: from.id,
          to: to.id
        });
      }
      return true;
    }
  });
}
export function effectiveSkillCost(g, t, unit, skillRef, fallback = null) {
  const skill = skillOf(unit, skillRef);
  let cost = state_catalog_cards.PlusStarModifierOwner.cost(unit, skill, fallback ?? skill?.cost ?? "");
  if (skill?.repeatCost && unit?.lastAction === "skill" && unit?.lastSkill === skill.id) cost = skill.repeatCost;
  let reduction = Math.max(0, Math.floor(Number(unit?.turnSkillCostReduction || 0)));
  if (reduction > 0) {
    const tokens = costTokens(cost);
    while (reduction-- > 0 && tokens.length) tokens.pop();
    cost = tokens.join("");
  }
  return cost;
}
export function effectiveSkillTarget(unit, skillRef) {
  const skill = skillOf(unit, skillRef);
  return state_catalog_cards.PlusStarModifierOwner.target(unit, skill);
}
export function skillRequirementsMet(unit, skillRef) {
  const skill = skillOf(unit, skillRef),
    requirements = skill?.requirements;
  if (!skill || !requirements) return !!skill;
  if (requirements.minShield != null && Number(unit?.shield || 0) + 1e-6 < Number(requirements.minShield)) return false;
  /* 특성에 묶인 사용 조건: 자기 기술일 때만, 특성이 켜져 있을 때만 적용한다. 특성봉인 중에는 모든 기술을 쓸 수 있고, 다른 유닛이 복사한 기술에는 걸리지 않는다. */
  const ownSkill = !!unit && (unit.presentationOnly ? false : card(unit)?.skills.some(x => x.id === skill.id));
  const bound = requirements.traitBound ? ownSkill && traitsActive(unit) : true;
  if (bound && requirements.shield === "present" && !(Number(unit?.shield || 0) > 0)) return false;
  if (bound && requirements.shield === "absent" && Number(unit?.shield || 0) > 0) return false;
  return true;
}
