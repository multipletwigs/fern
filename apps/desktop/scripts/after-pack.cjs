// electron-builder filters node_modules and dot-dirs out of extraResources, so
// copy the Next.js standalone bundle in ourselves. Dereference pnpm's symlinks
// so the app doesn't point back into the monorepo.
const { cpSync } = require("node:fs");
const path = require("node:path");

exports.default = async (context) => {
  const resources =
    context.electronPlatformName === "darwin"
      ? path.join(
          context.appOutDir,
          `${context.packager.appInfo.productFilename}.app`,
          "Contents/Resources",
        )
      : path.join(context.appOutDir, "resources");

  cpSync(
    path.resolve(__dirname, "../../web/.next/standalone"),
    path.join(resources, "web"),
    {
      recursive: true,
      dereference: true,
    },
  );
};
