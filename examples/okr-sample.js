// Synthetic, deterministic discussion. Each answer unlocks one item.
export const sampleSteps = [
  '# 2026 第四季度（2026-10-01 至 2026-12-31）\n## #O1 改善体力\n意义：支持日常生活；每周两小时；策略：短时训练；替代：散步；风险：过量；持续不适时调整。',
];
for (const [id, title] of [[1, '连续步行30分钟仍能正常交谈'], [2, '日常爬楼后自评疲劳较基线下降2分'], [3, '连续四周自评精力达到7分']]) {
  sampleSteps.push(sampleSteps.at(-1) + `\n### #KR${id} ${title}\n基线：未知，先测量；目标值：${title}；证据：合成练习日志；检查日期：2026-12-31。`);
}
export const sampleDraft = sampleSteps.at(-1);
export function sampleGuide() {
  return async ({ stage, workingDraft }) => {
    let next = stage, draft = workingDraft ?? null;
    if (stage === 'background') next = 'direction';
    else if (stage === 'direction') { next = 'okr'; draft = sampleSteps[0]; }
    else if (stage === 'okr') {
      const index = sampleSteps.indexOf(workingDraft);
      if (index >= 0 && index < 3) draft = sampleSteps[index + 1];
      else next = 'challenge';
    } else next = 'ready';
    return { stage: next, summary: '合成背景：每周两小时，健康方向待核对。',
      advice: '建议短时练习，因为投入受限；反向审视：指标达成却未改善生活时，需要检查证据和策略。',
      questions: next === 'ready' ? [] : ['当前这一项最需要核实的依据是什么？'], draft };
  };
}
