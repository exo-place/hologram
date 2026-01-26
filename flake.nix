{
  description = "hologram - Discord RP bot with smart context management";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            # Runtime
            bun
            # Native deps for sqlite-vec
            sqlite
            # Native deps for sharp (via @huggingface/transformers)
            vips
            pkg-config
          ];
          shellHook = ''
            git config core.hooksPath .githooks
          '';
          # sharp needs libstdc++
          LD_LIBRARY_PATH = pkgs.lib.makeLibraryPath [
            pkgs.stdenv.cc.cc.lib
          ];
        };
      }
    );
}
