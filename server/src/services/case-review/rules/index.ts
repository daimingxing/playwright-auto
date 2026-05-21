import { dynamicIdRule } from './dynamic-id';
import { structureSelectorRule } from './structure-selector';
import { transientStateClassRule } from './transient-state-class';
import { weakRoleSelectorRule } from './weak-role-selector';
import { wideFrameworkSelectorRule } from './wide-framework-selector';

export const reviewRules = [
  dynamicIdRule,
  wideFrameworkSelectorRule,
  transientStateClassRule,
  structureSelectorRule,
  weakRoleSelectorRule
];
