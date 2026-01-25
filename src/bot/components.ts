import {
  type MessageComponent,
  MessageComponentTypes,
  type ButtonStyles,
} from "@discordeno/bot";

/** Button definition for building action rows */
export interface ButtonDef {
  style: ButtonStyles;
  label: string;
  customId: string;
  disabled?: boolean;
}

/** Mapped type that preserves tuple length */
type MapTuple<T extends readonly unknown[], U> = { [K in keyof T]: U };

/** Map over a tuple preserving its length in the type system */
export function mapTuple<T extends readonly unknown[], U>(
  tuple: T,
  fn: (item: T[number], index: number) => U
): MapTuple<T, U> {
  return tuple.map(fn as (item: unknown, index: number) => U) as MapTuple<T, U>;
}

/** Build a button component from a definition */
function buildButton(def: ButtonDef) {
  return {
    type: MessageComponentTypes.Button as const,
    style: def.style,
    label: def.label,
    customId: def.customId,
    disabled: def.disabled,
  };
}

/** Build an action row from button definitions */
export function actionRow<T extends readonly ButtonDef[]>(
  buttons: T
): MessageComponent {
  return {
    type: MessageComponentTypes.ActionRow,
    components: mapTuple(buttons, buildButton),
  } as MessageComponent;
}

/** Build multiple action rows */
export function actionRows<T extends readonly (readonly ButtonDef[])[]>(
  rows: T
): MessageComponent[] {
  return [...mapTuple(rows, (row) => actionRow(row))];
}
