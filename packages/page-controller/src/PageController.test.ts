import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PageController } from './PageController'

describe('PageController', () => {
	beforeEach(() => {
		vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(100)
		vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(40)
		vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
			new DOMRect(0, 0, 100, 40)
		)
	})

	afterEach(() => {
		document.body.replaceChildren()
		vi.restoreAllMocks()
	})

	async function indexOf(controller: PageController, id: string): Promise<number> {
		const { content } = await controller.getBrowserState()
		const match = new RegExp(`\\[(\\d+)\\].*id=${id}(?:\\s|>)`).exec(content)
		if (!match) throw new Error(`Missing indexed element ${id}: ${content}`)
		return Number(match[1])
	}

	it('resolves indexed targets and rejects disabled or detached references', async () => {
		const button = document.createElement('button')
		button.id = 'target'
		button.textContent = 'Save'
		document.body.append(button)
		const controller = new PageController({ highlightOpacity: 0, highlightLabelOpacity: 0 })
		expect(() => controller.getElement(0)).toThrow('not indexed')
		const index = await indexOf(controller, button.id)
		expect(controller.getElement(index)).toBe(button)
		button.disabled = true
		expect(() => controller.getElement(index)).toThrow('unavailable')
		button.disabled = false
		button.remove()
		expect(() => controller.getElement(index)).toThrow('unavailable')
		controller.dispose()
	})

	it('allows validation to reject a click before it is dispatched', async () => {
		const button = document.createElement('button')
		button.id = 'target'
		button.textContent = 'Purchase'
		document.body.append(button)
		vi.spyOn(document, 'elementFromPoint').mockReturnValue(button)
		const clicked = vi.fn()
		button.addEventListener('click', clicked)
		const controller = new PageController({
			beforeAction: () => Promise.reject(new Error('Approval expired')),
		})
		const result = await controller.clickElement(await indexOf(controller, button.id))
		expect(result.success).toBe(false)
		expect(result.message).toContain('Approval expired')
		expect(clicked).not.toHaveBeenCalled()
		controller.dispose()
	})

	it('revalidates input after clicking and before changing its value', async () => {
		const input = document.createElement('input')
		input.id = 'target'
		input.value = 'original'
		document.body.append(input)
		vi.spyOn(document, 'elementFromPoint').mockReturnValue(input)
		let clicked = false
		input.addEventListener('click', () => {
			clicked = true
		})
		const controller = new PageController({
			beforeAction: async () => {
				if (clicked) throw new Error('Target changed during click')
			},
		})
		const result = await controller.inputText(await indexOf(controller, input.id), 'replacement')
		expect(clicked).toBe(true)
		expect(result.success).toBe(false)
		expect(input.value).toBe('original')
		controller.dispose()
	})

	it('does not select disabled options or dispatch their change events', async () => {
		const select = document.createElement('select')
		select.id = 'target'
		const standard = document.createElement('option')
		standard.textContent = 'Standard'
		standard.value = 'standard'
		const express = document.createElement('option')
		express.textContent = 'Express'
		express.value = 'express'
		express.disabled = true
		select.append(standard, express)
		document.body.append(select)
		const changed = vi.fn()
		select.addEventListener('change', changed)
		const controller = new PageController()
		const result = await controller.selectOption(await indexOf(controller, select.id), 'Express')
		expect(result.success).toBe(false)
		expect(select.value).toBe('standard')
		expect(changed).not.toHaveBeenCalled()
		controller.dispose()
	})

	it('observes live form values and referenced labels without creating invisible highlights', async () => {
		const input = document.createElement('input')
		input.id = 'email'
		input.setAttribute('value', 'old@example.com')
		input.value = 'new@example.com'
		const label = document.createElement('span')
		label.id = 'label'
		label.textContent = 'Save product'
		const button = document.createElement('button')
		button.setAttribute('aria-labelledby', label.id)
		button.textContent = 'Save'
		const privateRoot = document.createElement('div')
		privateRoot.dataset.pageAgentIgnore = 'true'
		privateRoot.textContent = 'Private chat'
		document.body.append(input, label, button, privateRoot)
		const controller = new PageController({ highlightOpacity: 0, highlightLabelOpacity: 0 })
		const { content } = await controller.getBrowserState()
		expect(content).toContain('new@example.com')
		expect(content).not.toContain('old@example.com')
		expect(content).toContain('aria-label=Save product')
		expect(content).not.toContain('Private chat')
		expect(document.querySelector('#playwright-highlight-container')).toBeNull()
		controller.dispose()
	})

	it('constructs and exposes the current url', async () => {
		const controller = new PageController()
		expect(controller).toBeInstanceOf(PageController)
		expect(await controller.getCurrentUrl()).toBe(window.location.href)
	})

	describe('executeJavascript', () => {
		it('runs a script and returns its result', async () => {
			const controller = new PageController()
			const result = await controller.executeJavascript('return 1 + 2')
			expect(result).toMatchObject({ success: true })
			expect(result.message).toContain('3')
		})

		it('exposes the abort signal to the script scope', async () => {
			const controller = new PageController()
			const controllerSignal = new AbortController()
			controllerSignal.abort()

			const result = await controller.executeJavascript(
				'return signal.aborted',
				controllerSignal.signal
			)
			expect(result).toMatchObject({ success: true })
			expect(result.message).toContain('true')
		})

		it('reports a syntax error as a failed result', async () => {
			const controller = new PageController()
			const result = await controller.executeJavascript('return (')
			expect(result.success).toBe(false)
			expect(result.message).toContain('❌')
		})
	})
})
