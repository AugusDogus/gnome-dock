with import <nixpkgs> {};
stdenv.mkDerivation {
    name = "gnome-dock";
    buildInputs = [ gnumake glib sassc ];
}
