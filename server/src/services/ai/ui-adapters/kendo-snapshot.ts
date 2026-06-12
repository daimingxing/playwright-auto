import type { Page } from '@playwright/test';
import type { TargetType, UiLibrary } from '../../../../../shared/types';
import type { PageElement, PageField, PageLocator } from '../page-context';

// 字段容器定位时只需要这些 class，避免把通用 class 一起塞进 XPath 影响匹配。
const kendoFieldSelector = '.k-dropdownlist,.k-combobox,.k-picker,.k-multiselect,.k-dropdowntree,.k-numerictextbox,.k-datepicker,.k-datetimepicker,.k-timepicker,[data-role="dropdownlist"],[data-role="combobox"],[data-role="datepicker"],[data-role="numerictextbox"]';
const maxItems = 20;
const maxText = 80;

interface KendoFieldInfo {
  name: string;
  value: string;
  source: PageField['source'];
  ui: string;
  type: string;
  required: boolean;
  state: PageField['state'];
  attrs: Record<string, string>;
  containerTag: string;
  containerClass: string;
  hasContainerLabel: boolean;
  ariaLabel: string;
  inputName: string;
  inputId: string;
}

/**
 * 读取 Kendo 控件对应的表单字段语义，供 Kendo 模式下的页面快照使用。
 */
export async function readKendoFields(page: Page): Promise<PageField[]> {
  const fields: PageField[] = [];
  const locator = page.locator(kendoFieldSelector);
  const count = Math.min(await locator.count(), maxItems);

  for (let index = 0; index < count; index += 1) {
    const item = locator.nth(index);

    if (!(await item.isVisible().catch(() => false))) {
      continue;
    }

    const info = await item.evaluate((element) => {
      const control = findKendoControl(element);
      const input = findKendoInput(control);
      const field = findFieldInfo(control, input);
      const container = field.container;
      const label = field.label;
      const ariaText = cleanLabel(control.getAttribute('aria-label') || control.getAttribute('title') || '');
      const fallbackName = cleanLabel(input?.getAttribute('name') || input?.getAttribute('id') || '');
      const source = label ? 'label-container' : ariaText ? 'aria' : 'heuristic';
      const name = label || ariaText || fallbackName;
      const value = readKendoValue(control, input);
      const attrs = readKendoAttrs(control, input);
      const className = control.getAttribute('class') || '';
      const dataRole = input?.getAttribute('data-role') || control.getAttribute('data-role') || '';
      const disabled = isDisabled(control, input, container);
      const readonly = isReadonly(control, input, container);

      return {
        name,
        value,
        source,
        ui: getKendoUi(className, dataRole),
        type: getKendoType(className, dataRole),
        required: Boolean(input?.required || field.required),
        state: disabled ? 'disabled' : readonly ? 'readonly' : 'enabled',
        attrs,
        containerTag: container?.tagName.toLowerCase() || '',
        containerClass: container?.getAttribute('class') || '',
        hasContainerLabel: Boolean(label && container),
        ariaLabel: ariaText,
        inputName: attrs.inputName || '',
        inputId: attrs.inputId || ''
      };

      function findKendoControl(target: Element) {
        return target.matches('.k-dropdownlist,.k-combobox,.k-picker,.k-multiselect,.k-dropdowntree,.k-numerictextbox,.k-datepicker,.k-datetimepicker,.k-timepicker')
          ? target
          : target.closest('.k-dropdownlist,.k-combobox,.k-picker,.k-multiselect,.k-dropdowntree,.k-numerictextbox,.k-datepicker,.k-datetimepicker,.k-timepicker') ?? target;
      }

      function findKendoInput(controlElement: Element) {
        if (controlElement.tagName.toLowerCase() === 'input') {
          return controlElement as HTMLInputElement;
        }

        return controlElement.querySelector('input,select,textarea') as HTMLInputElement | null;
      }

      function cleanLabel(value: string) {
        return value.replace(/\*/g, '').replace(/\s+/g, ' ').replace(/[:：]$/, '').trim();
      }

      function findFieldInfo(controlElement: Element, inputElement: HTMLInputElement | null) {
        const id = inputElement?.getAttribute('id') || '';
        const exactLabel = id ? document.querySelector(`label[for="${cssEscape(id)}"]`) : null;

        if (exactLabel) {
          return {
            label: cleanLabel(exactLabel.textContent ?? ''),
            required: isRequiredLabel(exactLabel),
            container: exactLabel.closest('.xr-fc,.i-select,.i-input,.k-form-field,.el-form-item,.ant-form-item')
          };
        }

        const scoped = controlElement.closest('.xr-fc,.i-select,.i-input,.k-form-field,.el-form-item,.ant-form-item');
        const scopedLabel = scoped?.querySelector('label,.field-label,.label,.el-form-item__label,.ant-form-item-label');

        if (scopedLabel) {
          return {
            label: cleanLabel(scopedLabel.textContent ?? ''),
            required: isRequiredLabel(scopedLabel),
            container: scoped
          };
        }

        const siblingLabel = findSiblingLabel(controlElement);

        if (siblingLabel) {
          const parent = siblingLabel.parentElement;

          return {
            label: cleanLabel(siblingLabel.textContent ?? ''),
            required: isRequiredLabel(siblingLabel),
            container: parent?.matches('.form-row,.field-row') ? null : parent
          };
        }

        return {
          label: '',
          required: false,
          container: null
        };
      }

      function findSiblingLabel(controlElement: Element) {
        let node = controlElement.previousElementSibling;

        while (node) {
          if (isKendoControl(node)) {
            return null;
          }

          if (node.matches('label,.field-label,.label,.el-form-item__label,.ant-form-item-label')) {
            return node;
          }

          const nested = node.querySelector('label,.field-label,.label,.el-form-item__label,.ant-form-item-label');

          if (nested) {
            return nested;
          }

          node = node.previousElementSibling;
        }

        return null;
      }

      function isKendoControl(node: Element) {
        return node.matches('.k-dropdownlist,.k-combobox,.k-picker,.k-multiselect,.k-dropdowntree,.k-numerictextbox,.k-datepicker,.k-datetimepicker,.k-timepicker,[data-role]');
      }

      function isRequiredLabel(labelElement: Element) {
        return Boolean(labelElement.querySelector('.i-input-required,[required]') || labelElement.textContent?.includes('*'));
      }

      function cssEscape(value: string) {
        return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      }

      function readKendoValue(controlElement: Element, inputElement: HTMLInputElement | null) {
        const text = controlElement.querySelector('.k-input-value-text,.k-input-inner,.k-input')?.textContent?.trim() || '';

        return text || inputElement?.value || '';
      }

      function readKendoAttrs(controlElement: Element, inputElement: HTMLInputElement | null) {
        const values: Record<string, string> = {};
        const attrPairs: Array<[string, string | null | undefined]> = [
          ['inputId', inputElement?.getAttribute('id')],
          ['inputName', inputElement?.getAttribute('name')],
          ['ariaControls', controlElement.getAttribute('aria-controls')],
          ['ariaExpanded', controlElement.getAttribute('aria-expanded')],
          ['ariaDisabled', controlElement.getAttribute('aria-disabled')],
          ['ariaReadonly', controlElement.getAttribute('aria-readonly')],
          ['dataRole', inputElement?.getAttribute('data-role') || controlElement.getAttribute('data-role')]
        ];

        for (const [key, value] of attrPairs) {
          if (value) {
            values[key] = value;
          }
        }

        return values;
      }

      function isDisabled(controlElement: Element, inputElement: HTMLInputElement | null, containerElement: Element | null) {
        const disabledRoot = controlElement.closest('fieldset[disabled],.k-disabled,.k-state-disabled,[aria-disabled="true"]') || containerElement?.closest('fieldset[disabled],.k-disabled,.k-state-disabled,[aria-disabled="true"]');

        return Boolean(disabledRoot || inputElement?.disabled || controlElement.classList.contains('k-disabled') || controlElement.classList.contains('k-state-disabled') || controlElement.getAttribute('aria-disabled') === 'true' || containerElement?.getAttribute('aria-disabled') === 'true');
      }

      function isReadonly(controlElement: Element, inputElement: HTMLInputElement | null, containerElement: Element | null) {
        const readonlyRoot = controlElement.closest('[aria-readonly="true"],.k-readonly,.k-state-readonly') || containerElement?.closest('[aria-readonly="true"],.k-readonly,.k-state-readonly');

        return Boolean(readonlyRoot || inputElement?.readOnly || controlElement.classList.contains('k-readonly') || controlElement.classList.contains('k-state-readonly') || controlElement.getAttribute('aria-readonly') === 'true' || containerElement?.classList.contains('k-readonly') || containerElement?.classList.contains('k-state-readonly'));
      }

      function getKendoUi(classNameValue: string, dataRoleValue: string) {
        if (classNameValue.includes('k-combobox') || dataRoleValue === 'combobox') {
          return 'kendo-combobox';
        }

        if (classNameValue.includes('k-multiselect')) {
          return 'kendo-multiselect';
        }

        if (classNameValue.includes('k-dropdowntree')) {
          return 'kendo-dropdowntree';
        }

        if (classNameValue.includes('k-datepicker') || classNameValue.includes('k-datetimepicker') || classNameValue.includes('k-timepicker')) {
          return 'kendo-datepicker';
        }

        if (classNameValue.includes('k-numerictextbox')) {
          return 'kendo-numerictextbox';
        }

        return 'kendo-dropdownlist';
      }

      function getKendoType(classNameValue: string, dataRoleValue: string) {
        if (classNameValue.includes('k-datepicker') || classNameValue.includes('k-datetimepicker') || classNameValue.includes('k-timepicker')) {
          return 'date';
        }

        if (classNameValue.includes('k-dropdownlist') || classNameValue.includes('k-combobox') || classNameValue.includes('k-multiselect') || classNameValue.includes('k-dropdowntree') || dataRoleValue === 'dropdownlist' || dataRoleValue === 'combobox') {
          return 'select';
        }

        return 'input';
      }
    });
    const name = normalizeText(info.name);

    if (!name) {
      continue;
    }

    const locators: PageLocator[] = [];
    const attrSelector = buildKendoAttrSelector(info);

    if (attrSelector) {
      locators.push({
        selector: attrSelector,
        kind: 'attr',
        unique: await countPageLocator(page, attrSelector),
        confidence: 'high',
        reason: '隐藏输入提供了 id 或 name 属性'
      });
    }

    const ariaSelector = buildKendoAriaSelector(info);

    if (ariaSelector) {
      locators.push({
        selector: ariaSelector,
        kind: 'label',
        unique: await countPageLocator(page, ariaSelector),
        confidence: 'medium',
        reason: '字段名来自控件 aria-label'
      });
    }

    if (locators.length === 0 && info.source === 'label-container' && info.hasContainerLabel) {
      const selector = buildKendoFieldSelector(info);

      locators.push({
        selector,
        kind: 'field-container',
        unique: await countPageLocator(page, selector),
        confidence: 'low',
        reason: '缺少可用 id/name/aria 时按字段容器兜底'
      });
    }

    fields.push({
      name,
      type: info.type as TargetType,
      ui: info.ui,
      required: info.required,
      value: normalizeText(info.value) || undefined,
      state: info.state as PageField['state'],
      locators,
      attrs: info.attrs,
      options: [],
      source: info.source as PageField['source'],
      confidence: info.source === 'label-container' ? 'high' : 'medium'
    });
  }

  return fields;
}

/**
 * 读取 Kendo 自定义下拉摘要，补足非原生 select 的页面上下文。
 */
export async function readKendoSelects(page: Page): Promise<PageElement[]> {
  const values: Array<Omit<PageElement, 'unique'>> = [];
  const counts: number[] = [];
  const selector = '.k-dropdownlist,.k-combobox,.k-picker,[data-role="dropdownlist"],[data-role="combobox"]';
  const locator = page.locator(selector);
  const count = Math.min(await locator.count(), maxItems);

  for (let index = 0; index < count; index += 1) {
    const item = locator.nth(index);

    if (!(await item.isVisible().catch(() => false))) {
      continue;
    }

    const info = await item.evaluate((element) => {
      const attrLabel = element.getAttribute('aria-label')?.trim() || element.getAttribute('title')?.trim() || '';
      const valueText = element.querySelector('.k-input-value-text,.k-input-inner,.k-input')?.textContent?.trim() || element.textContent?.trim() || '';
      const labelText = attrLabel || findNearLabel(element);

      return {
        label: labelText,
        text: valueText
      };

      function findNearLabel(target: Element) {
        const row = target.closest('.k-form-field,.form-row,.el-form-item,.ant-form-item,.field-row,td,li,div');
        const rowLabel = row?.querySelector('label,.field-label,.label,.el-form-item__label,.ant-form-item-label')?.textContent?.trim();

        if (rowLabel) {
          return rowLabel.replace(/[:：]$/, '').trim();
        }

        let previous = target.previousElementSibling;

        while (previous) {
          const text = previous.textContent?.trim().replace(/[:：]$/, '').trim();

          if (text) {
            return text;
          }

          previous = previous.previousElementSibling;
        }

        return '';
      }
    });
    const label = normalizeText(info.label);
    const text = normalizeText(info.text);

    if (!label && !text) {
      continue;
    }

    const key = label || text;

    values.push({
      label: label || undefined,
      text: text || undefined,
      locator: `getByLabel('${escapeText(key)}')`
    });
    counts.push(label ? await page.getByLabel(label).count() : await page.getByText(text, { exact: true }).count());
  }

  return resolveUnique(values, counts);
}

/**
 * 判断当前快照是否需要执行 Kendo 字段语义采集。
 */
export async function shouldCollectKendoFields(page: Page, uiLibrary: UiLibrary): Promise<boolean> {
  if (uiLibrary === 'native') {
    return false;
  }

  if (uiLibrary === 'kendo') {
    return true;
  }

  return (await page.locator(kendoFieldSelector).count()) > 0;
}

/**
 * 构造可由 page.locator 执行的 Kendo 字段容器定位器。
 */
function buildKendoFieldSelector(info: Pick<KendoFieldInfo, 'name' | 'containerTag' | 'containerClass'>) {
  const tag = info.containerTag || '*';
  const classPredicate = buildClassPredicate(info.containerClass);
  const controlPredicate = 'self::*[contains(concat(" ", normalize-space(@class), " "), " k-dropdownlist ") or contains(concat(" ", normalize-space(@class), " "), " k-combobox ") or contains(concat(" ", normalize-space(@class), " "), " k-picker ") or contains(concat(" ", normalize-space(@class), " "), " k-multiselect ") or contains(concat(" ", normalize-space(@class), " "), " k-dropdowntree ") or contains(concat(" ", normalize-space(@class), " "), " k-numerictextbox ") or contains(concat(" ", normalize-space(@class), " "), " k-datepicker ") or contains(concat(" ", normalize-space(@class), " "), " k-datetimepicker ") or contains(concat(" ", normalize-space(@class), " "), " k-timepicker ")]';

  return `xpath=//${tag}[${classPredicate}][.//*[self::label or contains(concat(" ", normalize-space(@class), " "), " field-label ") or contains(concat(" ", normalize-space(@class), " "), " label ")][contains(normalize-space(.), ${xpathLiteral(info.name)})]]//*[${controlPredicate}][1]`;
}

/**
 * 构造 aria-label 控件定位器，避免 aria 来源使用字段容器 XPath。
 */
function buildKendoAriaSelector(info: Pick<KendoFieldInfo, 'ariaLabel'>) {
  if (!info.ariaLabel) {
    return undefined;
  }

  return `[aria-label=${cssString(info.ariaLabel)}]`;
}

/**
 * 构造隐藏 input 属性定位器，优先返回短且可执行的 Playwright 定位器。
 */
function buildKendoAttrSelector(info: Pick<KendoFieldInfo, 'inputName' | 'inputId' | 'type' | 'ui'>) {
  const inputSelector = buildInputSelector(info);

  if (!inputSelector) {
    return undefined;
  }

  if (info.type === 'select') {
    const control = getKendoControlSelector(info.ui);

    return `locator('${control}:has(${inputSelector})')`;
  }

  return inputSelector;
}

function buildInputSelector(info: Pick<KendoFieldInfo, 'inputName' | 'inputId'>) {
  if (info.inputId) {
    return isSimpleCssId(info.inputId) ? `input#${info.inputId}` : `input[id=${cssString(info.inputId)}]`;
  }

  if (info.inputName) {
    return `input[name=${cssString(info.inputName)}]`;
  }

  return undefined;
}

function getKendoControlSelector(ui: string) {
  const selectors: Record<string, string> = {
    'kendo-combobox': '.k-combobox',
    'kendo-multiselect': '.k-multiselect',
    'kendo-dropdowntree': '.k-dropdowntree',
    'kendo-datepicker': '.k-datepicker',
    'kendo-numerictextbox': '.k-numerictextbox',
    'kendo-dropdownlist': '.k-dropdownlist'
  };

  return selectors[ui] ?? '.k-picker';
}

function isSimpleCssId(value: string) {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(value);
}

async function countPageLocator(page: Page, selector: string) {
  const css = readLocatorCss(selector);

  return page.locator(css ?? selector).count().then((matchCount) => matchCount === 1).catch(() => false);
}

function readLocatorCss(selector: string) {
  const match = selector.match(/^locator\((['"])(.*)\1\)$/);

  return match?.[2];
}

function buildClassPredicate(className: string) {
  const classes = className.split(/\s+/).filter((item) => ['xr-fc', 'i-select', 'i-input', 'k-form-field', 'el-form-item', 'ant-form-item', 'form-row', 'field-row'].includes(item));

  if (!classes.length) {
    return 'true()';
  }

  return classes.map((item) => `contains(concat(" ", normalize-space(@class), " "), " ${item} ")`).join(' and ');
}

function xpathLiteral(value: string) {
  if (!value.includes("'")) {
    return `'${value}'`;
  }

  if (!value.includes('"')) {
    return `"${value}"`;
  }

  return `concat(${value.split("'").map((part) => `'${part}'`).join(', "\'", ')})`;
}

function cssString(value: string) {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function normalizeText(value: string | null | undefined) {
  return (value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxText);
}

function resolveUnique<T extends Omit<PageElement, 'unique'>>(items: T[], counts: number[]) {
  return items.map((item, index) => ({
    ...item,
    unique: counts[index] === 1
  }));
}

function escapeText(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
