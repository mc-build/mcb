import { PosInfo, Token } from "./Tokenizer";

export type JsonTagType =
  | { kind: "Tag"; subType: string; replace: boolean; entries: AstNode[] }
  | { kind: "Advancement"; entries: AstNode[] }
  | { kind: "ItemModifier"; entries: AstNode[] }
  | { kind: "LootTable"; entries: AstNode[] }
  | { kind: "Predicate"; entries: AstNode[] }
  | { kind: "Recipe"; entries: AstNode[] }
  | { kind: "ChatType"; entries: AstNode[] }
  | { kind: "DamageType"; entries: AstNode[] }
  | { kind: "Dimension"; entries: AstNode[] }
  | { kind: "DimensionType"; entries: AstNode[] }
  | { kind: "Enchantment"; entries: AstNode[] }
  | { kind: "WorldGen"; subType: string; name: string; entries: AstNode[] };

export type CompileTimeIfElseExpressions = Array<{
  condition: string | null;
  node: AstNode[];
}>;

export type AstNode =
  | { type: "Raw"; pos: PosInfo; value: string; continuations?: AstNode[] | null; isMacro?: boolean }
  | { type: "FunctionDef"; pos: PosInfo; name: string; body: AstNode[]; appendTo?: string | null }
  | { type: "TemplateDef"; pos: PosInfo; name: string; body: AstNode[] }
  | { type: "Directory"; pos: PosInfo; name: string; body: AstNode[] }
  | { type: "Import"; pos: PosInfo; name: string }
  | { type: "CompileTimeLoop"; pos: PosInfo; expression: string; as?: string[] | null; body: AstNode[] }
  | { type: "CompileTimeIf"; pos: PosInfo; expression: string; body: AstNode[]; elseExpressions: CompileTimeIfElseExpressions }
  | { type: "MultiLineScript"; pos: PosInfo; value: Token[] }
  | { type: "Block"; pos: PosInfo; name?: string | null; body: AstNode[]; data?: string | null; isMacro?: boolean; isInline?: boolean }
  | { type: "TickBlock"; pos: PosInfo; body: AstNode[] }
  | { type: "LoadBlock"; pos: PosInfo; body: AstNode[] }
  | { type: "ExecuteBlock"; pos: PosInfo; execute: string; data?: string | null; body: AstNode[]; continuations?: AstNode[] | null; isMacro?: boolean }
  | { type: "ScheduleBlock"; pos: PosInfo; delay: string; blockType: string; body: AstNode[]; isMacro?: boolean }
  | { type: "SequenceBlock"; pos: PosInfo; body: AstNode[] }
  | { type: "RuntimeLoop"; pos: PosInfo; expression: string; body: AstNode[] }
  | { type: "Comment"; pos: PosInfo; value: string }
  | { type: "JsonFile"; pos: PosInfo; name: string; info: JsonTagType }
  | { type: "TemplateOverload"; pos: PosInfo; args: string; body: AstNode[] }
  | { type: "ClockExpr"; pos: PosInfo; name: string; time: string; body: AstNode[] }
  | { type: "Execute"; pos: PosInfo; command: string; value: AstNode; isMacro?: boolean }
  | { type: "FunctionCall"; pos: PosInfo; name: string; data: string; isMacro?: boolean }
  | { type: "EqCommand"; pos: PosInfo; command: string }
  | { type: "ScheduleCall"; pos: PosInfo; delay: string; target: string; mode: string; isMacro?: boolean }
  | { type: "ReturnRun"; pos: PosInfo; value: AstNode; isMacro?: boolean }
  | { type: "ScheduleClear"; pos: PosInfo; target: string; isMacro?: boolean }
  | { type: "Void" }
  | { type: "Group"; body: AstNode[] };

export enum AstNodeIds {
  Raw = 0,
  FunctionDef = 1,
  TemplateDef = 2,
  Directory = 3,
  Import = 4,
  CompileTimeLoop = 5,
  CompileTimeIf = 6,
  MultiLineScript = 7,
  Block = 8,
  TickBlock = 9,
  LoadBlock = 10,
  ExecuteBlock = 11,
  ScheduleBlock = 12,
  SequenceBlock = 13,
  RuntimeLoop = 14,
  Comment = 16,
  JsonFile = 17,
  ClockExpr = 19,
  Execute = 20,
  FunctionCall = 21,
  EqCommand = 22,
  ScheduleCall = 23,
  ReturnRun = 24,
}

export const AstNodeUtils = {
  getPos(node: AstNode): PosInfo {
    if (node.type === "Group" || node.type === "Void") {
      throw new Error("Group/Void nodes do not have a single position");
    }
    return node.pos;
  },
};
