export interface NliInput {
  name: "input_ids" | "attention_mask" | "token_type_ids";
  data: BigInt64Array;
  dims: number[];
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid NLI message");
  return value as Record<string, unknown>;
}
export function parseNliInputs(value: unknown): NliInput[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 3)
    throw new Error("Invalid NLI inputs");
  const inputs = value.map((raw): NliInput => {
    const input = object(raw);
    if (
      input.name !== "input_ids" &&
      input.name !== "attention_mask" &&
      input.name !== "token_type_ids"
    )
      throw new Error("Invalid NLI input name");
    if (
      !(input.data instanceof BigInt64Array) ||
      !Array.isArray(input.dims) ||
      input.dims.length !== 2 ||
      !input.dims.every(
        (n: unknown) => typeof n === "number" && Number.isSafeInteger(n) && n > 0,
      ) ||
      input.dims[0] > 5 ||
      input.dims[1] > 192 ||
      input.dims[0] * input.dims[1] !== input.data.length
    )
      throw new Error("Invalid NLI input dimensions");
    return { name: input.name, data: input.data, dims: [input.dims[0], input.dims[1]] };
  });
  const names = new Set(inputs.map((i) => i.name));
  if (
    names.size !== inputs.length ||
    !names.has("input_ids") ||
    !names.has("attention_mask") ||
    inputs.some((i) => i.dims.join() !== inputs[0]?.dims.join())
  )
    throw new Error("Inconsistent NLI inputs");
  return inputs;
}
export function encodeNliInputs(inputs: Record<string, unknown>): NliInput[] {
  return parseNliInputs(
    Object.entries(inputs).map(([name, value]) => {
      const tensor = object(value);
      if (tensor.type !== "int64") throw new Error("Expected int64 NLI input");
      return { name, data: tensor.data, dims: tensor.dims };
    }),
  );
}
export function parseNliLogits(
  value: unknown,
  batch: number,
): { data: Float32Array; dims: number[] } {
  const result = object(value);
  if (
    !(result.data instanceof Float32Array) ||
    result.data.length !== batch * 3 ||
    !result.data.every(Number.isFinite) ||
    !Array.isArray(result.dims) ||
    result.dims[0] !== batch ||
    result.dims[1] !== 3 ||
    result.dims.length !== 2
  )
    throw new Error("Invalid NLI logits");
  return { data: result.data, dims: [batch, 3] };
}
