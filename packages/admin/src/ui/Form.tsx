/**
 * @b9g/admin - Form components
 *
 * Dynamic form generation from table metadata using Crank.js and USWDS
 */

import type {ColumnMetadata, TableMetadata} from "../types.js";

export interface FormFieldProps {
	column: ColumnMetadata;
	value?: unknown;
	error?: string;
}

/**
 * Render a single form field based on column metadata
 */
export function FormField({column, value, error}: FormFieldProps) {
	const id = `field-${column.key}`;
	const isRequired = column.notNull && !column.hasDefault && !column.isPrimaryKey;

	// Skip primary key fields (auto-generated)
	if (column.isPrimaryKey && column.hasDefault) {
		return null;
	}

	// Determine input type based on dataType and enumValues
	if (column.enumValues && column.enumValues.length > 0) {
		return (
			<div class="usa-form-group">
				<label class="usa-label" for={id}>
					{column.name}
					{isRequired && <span class="text-secondary-dark"> *</span>}
				</label>
				<select
					class={`usa-select${error ? " usa-input--error" : ""}`}
					id={id}
					name={column.key}
					required={isRequired}
				>
					{!isRequired && <option value="">-- Select --</option>}
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
						name={column.key}
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

	// Date/datetime
	if (column.dataType === "date") {
		const dateValue = value instanceof Date ? value.toISOString().split("T")[0] : (value as string) || "";
		return (
			<div class="usa-form-group">
				<label class="usa-label" for={id}>
					{column.name}
					{isRequired && <span class="text-secondary-dark"> *</span>}
				</label>
				<input
					class={`usa-input${error ? " usa-input--error" : ""}`}
					id={id}
					name={column.key}
					type="date"
					value={dateValue}
					required={isRequired}
				/>
				{error && <span class="usa-error-message">{error}</span>}
			</div>
		);
	}

	if (column.dataType === "datetime") {
		const dtValue = value instanceof Date ? value.toISOString().slice(0, 16) : (value as string) || "";
		return (
			<div class="usa-form-group">
				<label class="usa-label" for={id}>
					{column.name}
					{isRequired && <span class="text-secondary-dark"> *</span>}
				</label>
				<input
					class={`usa-input${error ? " usa-input--error" : ""}`}
					id={id}
					name={column.key}
					type="datetime-local"
					value={dtValue}
					required={isRequired}
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
					{isRequired && <span class="text-secondary-dark"> *</span>}
				</label>
				<input
					class={`usa-input${error ? " usa-input--error" : ""}`}
					id={id}
					name={column.key}
					type="number"
					value={value != null ? String(value) : ""}
					required={isRequired}
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
					{isRequired && <span class="text-secondary-dark"> *</span>}
				</label>
				<textarea
					class={`usa-textarea${error ? " usa-input--error" : ""}`}
					id={id}
					name={column.key}
					rows={5}
					required={isRequired}
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
				{isRequired && <span class="text-secondary-dark"> *</span>}
			</label>
			<input
				class={`usa-input${error ? " usa-input--error" : ""}`}
				id={id}
				name={column.key}
				type="text"
				value={value != null ? String(value) : ""}
				required={isRequired}
			/>
			{error && <span class="usa-error-message">{error}</span>}
		</div>
	);
}

export interface ModelFormProps {
	metadata: TableMetadata;
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
	metadata,
	values = {},
	errors = {},
	action,
	submitLabel,
	cancelUrl,
}: ModelFormProps) {
	return (
		<form class="usa-form admin-form" method="POST" action={action}>
			{metadata.columns.map((col) => (
				<FormField column={col} value={values[col.key]} error={errors[col.key]} />
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
 * @param metadata - Table metadata for type coercion
 * @param options.isUpdate - If true, empty nullable fields are set to null (for clearing).
 *                           If false (create), empty nullable fields are omitted (use DB default).
 */
export function parseFormData(
	formData: FormData,
	metadata: TableMetadata,
	options: {isUpdate?: boolean} = {},
): Record<string, unknown> {
	const {isUpdate = false} = options;
	const result: Record<string, unknown> = {};

	for (const column of metadata.columns) {
		// Skip auto-generated primary keys
		if (column.isPrimaryKey && column.hasDefault) {
			continue;
		}

		const raw = formData.get(column.key);

		// Handle boolean (checkbox)
		// When unchecked, formData won't contain the field (raw === null)
		if (column.dataType === "boolean") {
			if (raw === null) {
				// Checkbox unchecked
				if (isUpdate) {
					// On update, explicitly set to false to allow clearing
					result[column.key] = false;
				} else if (!column.notNull || column.hasDefault) {
					// On create, skip to let DB use default
					continue;
				} else {
					// Required boolean with no default - explicitly set false
					result[column.key] = false;
				}
				continue;
			}
			result[column.key] = raw === "true";
			continue;
		}

		// Handle null/empty
		if (raw === null || raw === "") {
			if (isUpdate && !column.notNull) {
				// On update, explicitly set nullable fields to null to allow clearing
				result[column.key] = null;
				continue;
			}
			if (!column.notNull || column.hasDefault) {
				// On create, optional field - don't include, let DB use default
				continue;
			}
			result[column.key] = null;
			continue;
		}

		const value = String(raw);

		// Type coercion
		switch (column.dataType) {
			case "number":
				result[column.key] = parseFloat(value);
				break;
			case "date":
			case "datetime":
				result[column.key] = new Date(value);
				break;
			case "json":
				try {
					result[column.key] = JSON.parse(value);
				} catch {
					result[column.key] = value;
				}
				break;
			default:
				result[column.key] = value;
		}
	}

	return result;
}
