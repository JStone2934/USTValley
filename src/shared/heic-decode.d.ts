declare module "heic-decode" {
  type Image = { width: number; height: number; data: Uint8Array };
  type Item = { width: number; height: number; decode(): Promise<Image> };
  const decode: {
    (args: { buffer: Uint8Array }): Promise<Image>;
    all(args: { buffer: Uint8Array }): Promise<Item[] & { dispose(): void }>;
  };
  export default decode;
}
