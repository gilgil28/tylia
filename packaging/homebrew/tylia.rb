# Homebrew cask for the gilgil28/homebrew-tap repository (Casks/tylia.rb there):
#   brew install --cask gilgil28/tap/tylia
# Bump with packaging/release-manifests.sh <version> after a release (docs/RELEASING.md).
cask "tylia" do
  version "0.3.0"
  sha256 "0000000000000000000000000000000000000000000000000000000000000000"

  url "https://github.com/gilgil28/tylia/releases/download/v#{version}/Tylia_#{version}_universal.dmg"
  name "Tylia"
  desc "Calm, fast desktop Git client"
  homepage "https://gilgil28.github.io/tylia/"

  livecheck do
    url :url
    strategy :github_latest
  end

  # Tylia's own update check (off by default) replaces the app in place.
  auto_updates true
  depends_on macos: ">= :monterey"

  app "Tylia.app"
  binary "#{appdir}/Tylia.app/Contents/MacOS/tylia"

  zap trash: [
    "~/Library/Application Support/dev.tylia.app",
    "~/Library/Caches/dev.tylia.app",
    "~/Library/Saved Application State/dev.tylia.app.savedState",
    "~/Library/WebKit/dev.tylia.app",
  ]

  caveats <<~EOS
    Tylia isn't signed with an Apple Developer ID yet, so macOS blocks its first start.
    Open it once from Finder with right-click → Open, or allow it under System Settings →
    Privacy & Security → Open Anyway.
  EOS
end
