/**
 * @b9g/admin - Form components
 *
 * Dynamic form generation from table metadata using Crank.js and USWDS
 */

import type {AdminColumnInfo, AdminTableInfo} from "../core/introspection.js";

export interface FormFieldProps {
	column: AdminColumnInfo;
	value?: unknown;
	error?: string;
}

/**
 * Render a single form field based on column metadata
 */
export function FormField({column, value, error}: FormFieldProps) {
	const id = `field-${column.name}`;

	// Skip auto-generated primary key fields
	if (column.isPrimaryKey && column.hasAutoValue) {
		return null;
	}

	// Determine input type based on dataType and enumValues
	if (column.enumValues && column.enumValues.length > 0) {
		return (
			<div class="usa-form-group">
				<label class="usa-label" for={id}>
					{column.name}
					{column.required && <span class="text-secondary-dark"> *</span>}
				</label>
				<select
					class={`usa-select${error ? " usa-input--error" : ""}`}
					id={id}
					name={column.name}
					required={column.required}
				>
					{!column.required && <option value="">-- Select --</option>}
					{column.enumValues.map((opt) => (
						<option value={opt} selected={value === opt}>
							{opt}
						</option>
					))}
				</select>
				{error && <span class="usa-error-message">{error}</span>}
			</div>
		);
	}

	// Boolean -> checkbox
	// Handle both boolean true and string "true" (from form re-render after validation error)
	if (column.dataType === "boolean") {
		const isChecked = value === true || value === "true";
		return (
			<div class="usa-form-group">
				<div class="usa-checkbox">
					<input
						class="usa-checkbox__input"
						id={id}
						type="checkbox"
						name={column.name}
						value="true"
						checked={isChecked}
					/>
					<label class="usa-checkbox__label" for={id}>
						{column.name}
					</label>
				</div>
				{error && <span class="usa-error-message">{error}</span>}
			</div>
		);
	}

	// Date/datetime - use local time to avoid UTC shift
	if (column.dataType === "date") {
		let dateValue = "";
		if (value instanceof Date) {
			const y = value.getFullYear();
			const m = String(value.getMonth() + 1).padStart(2, "0");
			const d = String(value.getDate()).padStart(2, "0");
			dateValue = `${y}-${m}-${d}`;
		} else {
			dateValue = (value as string) || "";
		}
		return (
			<div class="usa-form-group">
				<label class="usa-label" for={id}>
					{column.name}
					{column.required && <span class="text-secondary-dark"> *</span>}
				</label>
				<input
					class={`usa-input${error ? " usa-input--error" : ""}`}
					id={id}
					name={column.name}
					type="date"
					value={dateValue}
					required={column.required}
				/>
				{error && <span class="usa-error-message">{error}</span>}
			</div>
		);
	}

	if (column.dataType === "datetime") {
		let dtValue = "";
		if (value instanceof Date) {
			const y = value.getFullYear();
			const mo = String(value.getMonth() + 1).padStart(2, "0");
			const d = String(value.getDate()).padStart(2, "0");
			const h = String(value.getHours()).padStart(2, "0");
			const mi = String(value.getMinutes()).padStart(2, "0");
			dtValue = `${y}-${mo}-${d}T${h}:${mi}`;
		} else {
			dtValue = (value as string) || "";
		}
		return (
			<div class="usa-form-group">
				<label class="usa-label" for={id}>
					{column.name}
					{column.required && <span class="text-secondary-dark"> *</span>}
				</label>
				<input
					class={`usa-input${error ? " usa-input--error" : ""}`}
					id={id}
					name={column.name}
					type="datetime-local"
					value={dtValue}
					required={column.required}
				/>
				{error && <span class="usa-error-message">{error}</span>}
			</div>
		);
	}

	// Number
	if (column.dataType === "number") {
		return (
			<div class="usa-form-group">
				<label class="usa-label" for={id}>
					{column.name}
					{column.required && <span class="text-secondary-dark"> *</span>}
				</label>
				<input
					class={`usa-input${error ? " usa-input--error" : ""}`}
					id={id}
					name={column.name}
					type="number"
					value={value != null ? String(value) : ""}
					required={column.required}
				/>
				{error && <span class="usa-error-message">{error}</span>}
			</div>
		);
	}

	// JSON -> textarea
	if (column.dataType === "json") {
		const jsonValue = value != null ? JSON.stringify(value, null, 2) : "";
		return (
			<div class="usa-form-group">
				<label class="usa-label" for={id}>
					{column.name}
					{column.required && <span class="text-secondary-dark"> *</span>}
				</label>
				<textarea
					class={`usa-textarea${error ? " usa-input--error" : ""}`}
					id={id}
					name={column.name}
					rows={5}
					required={column.required}
				>
					{jsonValue}
				</textarea>
				{error && <span class="usa-error-message">{error}</span>}
			</div>
		);
	}

	// Default: text input
	return (
		<div class="usa-form-group">
			<label class="usa-label" for={id}>
				{column.name}
				{column.required && <span class="text-secondary-dark"> *</span>}
			</label>
			<input
				class={`usa-input${error ? " usa-input--error" : ""}`}
				id={id}
				name={column.name}
				type="text"
				value={value != null ? String(value) : ""}
				required={column.required}
			/>
			{error && <span class="usa-error-message">{error}</span>}
		</div>
	);
}

export interface ModelFormProps {
	tableInfo: AdminTableInfo;
	values?: Record<string, unknown>;
	errors?: Record<string, string>;
	action: string;
	submitLabel: string;
	cancelUrl: string;
}

/**
 * Render a complete form for a model
 */
export function ModelForm({
	tableInfo,
	values = {},
	errors = {},
	action,
	submitLabel,
	cancelUrl,
}: ModelFormProps) {
	return (
		<form class="usa-form admin-form" method="POST" action={action}>
			{tableInfo.columns.map((col) => (
				<FormField
					column={col}
					value={values[col.name]}
					error={errors[col.name]}
				/>
			))}
			<div class="admin-form-actions">
				<button type="submit" class="usa-button">
					{submitLabel}
				</button>
				<a href={cancelUrl} class="usa-button usa-button--outline">
					Cancel
				</a>
			</div>
		</form>
	);
}

/**
 * Parse form data into typed values based on column metadata
 *
 * @param formData - The form data to parse
 * @param tableInfo - Table info for type coercion
 * @param options.isUpdate - If true, empty nullable fields are set to null (for clearing).
 *                           If false (create), empty nullable fields are omitted (use DB default).
 */
export function parseFormData(
	formData: FormData,
	tableInfo: AdminTableInfo,
	options: {isUpdate?: boolean} = {},
): Record<string, unknown> {
	const {isUpdate = false} = options;
	const result: Record<string, unknown> = {};

	for (const column of tableInfo.columns) {
		// Skip auto-generated primary keys
		if (column.isPrimaryKey && column.hasAutoValue) {
			continue;
		}

		const raw = formData.get(column.name);

		// Handle boolean (checkbox)
		// When unchecked, formData won't contain the field (raw === null)
		if (column.dataType === "boolean") {
			if (raw === null) {
				// Checkbox unchecked
				if (isUpdate) {
					// On update, explicitly set to false to allow clearing
					result[column.name] = false;
				} else if (!column.required) {
					// On create, optional - skip to let DB use default
					continue;
				} else {
					// Required boolean with no default - explicitly set false
					result[column.name] = false;
				}
				continue;
			}
			result[column.name] = raw === "true";
			continue;
		}

		// Handle null/empty
		if (raw === null || raw === "") {
			if (isUpdate && !column.required) {
				// On update, explicitly set nullable fields to null to allow clearing
				result[column.name] = null;
				continue;
			}
			if (!column.required) {
				// On create, optional field - don't include, let DB use default
				continue;
			}
			result[column.name] = null;
			continue;
		}

		const value = String(raw);

		// Type coercion
		switch (column.dataType) {
			case "number":
				result[column.name] = parseFloat(value);
				break;
			case "date":
			case "datetime":
				result[column.name] = new Date(value);
				break;
			case "json":
				try {
					result[column.name] = JSON.parse(value);
				} catch (_err) {
					// Invalid JSON - store as raw string
					result[column.name] = value;
				}
				break;
			default:
				result[column.name] = value;
		}
	}

	return result;
}
