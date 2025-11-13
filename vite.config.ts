import { defineConfig } from 'vite'
import eslint from 'vite-plugin-eslint';
import react from '@vitejs/plugin-react'
import { configDefaults } from 'vitest/config'
import path from 'path';

// APIファイルからReactを除外するプラグイン
function excludeReactFromApi() {
  return {
    name: 'exclude-react-from-api',
    resolveId(id, importer) {
      // APIファイルからReact関連のモジュールを除外
      if (importer && (
        importer.includes('/api/strength.html') ||
        importer.includes('/api/serialize.html') ||
        importer.includes('/api/deserialize.html')
      )) {
        if (id === 'react' || id === 'react-dom' || id === 'react/jsx-runtime' || 
            id === 'react-i18next' || id.startsWith('react/') || id.startsWith('react-dom/')) {
          // 空のモジュールを返す
          return { id: '\0virtual:react-stub', moduleSideEffects: false };
        }
      }
      return null;
    },
    load(id) {
      if (id === '\0virtual:react-stub') {
        // 空のモジュールを返す
        return 'export default {};';
      }
      return null;
    },
  };
}

export default defineConfig({
  base: '/pokesleep-tool/',
  plugins: [
    excludeReactFromApi(),
    eslint(), 
    react({
      // APIファイルにはReactプラグインを適用しない
      exclude: /\/api\/.*\.html$/,
    })
  ],
  build: {
    rollupOptions: {
      input: {
        reserchEn: path.resolve(__dirname, 'index.html'),
        reserchJa: path.resolve(__dirname, 'index.ja.html'),
        reserchKo: path.resolve(__dirname, 'index.ko.html'),
        reserchZhCn: path.resolve(__dirname, 'index.zh-cn.html'),
        reserchZhTw: path.resolve(__dirname, 'index.zh-tw.html'),
        ivEn: path.resolve(__dirname, 'iv/index.html'),
        ivJa: path.resolve(__dirname, 'iv/index.ja.html'),
        ivKo: path.resolve(__dirname, 'iv/index.ko.html'),
        ivZhCn: path.resolve(__dirname, 'iv/index.zh-cn.html'),
        ivZhTw: path.resolve(__dirname, 'iv/index.zh-tw.html'),
        apiSerialize: path.resolve(__dirname, 'api/serialize.html'),
        apiDeserialize: path.resolve(__dirname, 'api/deserialize.html'),
        apiStrength: path.resolve(__dirname, 'api/strength.html'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          // APIファイルのエントリーポイントはapiディレクトリに配置
          const name = chunkInfo.name || '';
          const facadeModuleId = chunkInfo.facadeModuleId || '';
          if (name.startsWith('api') || facadeModuleId.includes('/api/')) {
            return 'api/[name]-[hash].js';
          }
          return 'assets/[name]-[hash].js';
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          // APIファイルのHTMLはapiディレクトリに配置
          if (assetInfo.name && (assetInfo.name.includes('serialize.html') || 
              assetInfo.name.includes('deserialize.html') || 
              assetInfo.name.includes('strength.html'))) {
            return 'api/[name][extname]';
          }
          return 'assets/[name]-[hash][extname]';
        },
        manualChunks(id, { getModuleInfo }) {
          const moduleInfo = getModuleInfo(id);
          if (!moduleInfo) return undefined;

          // このモジュールがAPIエントリーポイントから参照されているかチェック
          const checkIsApiModule = (moduleId: string): boolean => {
            const info = getModuleInfo(moduleId);
            if (!info) return false;

            // エントリーポイントかチェック
            if (info.isEntry) {
              return moduleId.includes('/api/strength.html') ||
                     moduleId.includes('/api/serialize.html') ||
                     moduleId.includes('/api/deserialize.html');
            }

            // インポーターを再帰的にチェック
            for (const importer of info.importers || []) {
              if (checkIsApiModule(importer)) {
                return true;
              }
            }
            return false;
          };

          const isApiModule = checkIsApiModule(id);

          // Third-party libraries
          if (id.includes('node_modules')) {
            if (id.includes('@mui') || id.includes('@emotion')) {
              // APIファイルはMUIを含まない
              return isApiModule ? undefined : 'mui';
            }
            // react-i18nextはreactチャンクに含めるが、i18nextは別チャンクに
            if (id.includes('react-i18next')) {
              // APIファイルはreact-i18nextを含まない
              return isApiModule ? undefined : 'react';
            }
            if (id.includes('react') || id.includes('scheduler')) {
              // APIファイルはReactを含まない
              return isApiModule ? undefined : 'react';
            }
            // i18nextは独立したチャンクに（APIファイルで使用）
            if (id.includes('i18next') && !id.includes('react-i18next')) {
              return isApiModule ? 'api-i18n-core' : 'i18n-core';
            }
            // その他のvendorライブラリ
            return isApiModule ? 'api-vendor' : 'vendor';
          }

          if (id.includes('pokemon.json')) {
            return isApiModule ? 'api-pokemon' : 'pokemon';
          }
          if (id.includes('field.json')) {
            return isApiModule ? 'api-field' : 'field';
          }
          if (id.includes('event.json')) {
            return isApiModule ? 'api-event' : 'event';
          }
          if (id.includes('news.json')) {
            return isApiModule ? 'api-news' : 'news';
          }
          if (id.includes('/src/i18n/') || id.includes('/src/i18n.ts')) {
            // APIファイルはreact-i18nextを使うi18n.tsを含まない
            return isApiModule ? undefined : 'i18n';
          }
          if (id.includes('/src/i18n-api.ts')) {
            return 'api-i18n';
          }
          if (id.includes('PokemonIconData.ts')) {
            return isApiModule ? 'api-pokemon-icon' : 'pokemon-icon';
          }
          if (id.includes('ui/Resources')) {
            return isApiModule ? 'api-svg-icon' : 'svg-icon';
          }
          // Catch-all for any other data files
          if (id.includes('/src/data')) {
            return isApiModule ? 'api-data' : 'data';
          }

          // Utility modules
          if (id.includes('/src/util/')) {
            return isApiModule ? 'api-util' : 'util';
          }

          // Common UI components (Dialog, common, etc.)
          if (id.includes('/src/ui/')) {
            // APIファイルはUIコンポーネントを含まない
            return isApiModule ? undefined : 'ui';
          }

          return undefined;
        }
      }
    },
  },
  server: {
    open: true,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    exclude: [...configDefaults.exclude],
  },
})
