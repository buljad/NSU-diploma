import adapter from '@sveltejs/adapter-auto';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte'; // <--- ДОБАВИТЬ ЭТО

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Добавь эту строку, чтобы Svelte понимал TypeScript в .svelte файлах
	preprocess: vitePreprocess(), 

	kit: {
		adapter: adapter(),
		// Если ты используешь alias в Vite, SvelteKit должен о них знать
		alias: {
			'@stabilometer/shared': '../shared/src'
		}
	}
};

export default config;