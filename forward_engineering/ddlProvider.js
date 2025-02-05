const defaultTypes = require('./configs/defaultTypes');
const types = require('./configs/types');
const templates = require('./configs/templates');
const {
	isActivatedPartition,
	getTablePartitioning,
	getClusteringKey,
	getTableOptions,
	getColumnSchema,
	generateViewSelectStatement,
	getTimestamp,
	escapeQuotes,
} = require('./helpers/utils');

module.exports = (baseProvider, options, app) => {
	const { tab, commentIfDeactivated, hasType } = app.require('@hackolade/ddl-fe-utils').general;
	const assignTemplates = app.require('@hackolade/ddl-fe-utils').assignTemplates;
	const _ = app.require('lodash');
	const { getLabels, getFullName, getContainerOptions, getViewOptions } = require('./helpers/general')(app);

	return {
		createDatabase({
			databaseName,
			friendlyName,
			description,
			ifNotExist,
			projectId,
			defaultExpiration,
			customerEncryptionKey,
			labels,
		}) {
			return assignTemplates(templates.createDatabase, {
				name: getFullName(projectId, databaseName),
				ifNotExist: ifNotExist ? ' IF NOT EXISTS' : '',
				dbOptions: getContainerOptions({
					friendlyName,
					description,
					defaultExpiration,
					customerEncryptionKey,
					labels,
				}),
			});
		},

		createTable(
			{
				name,
				columns,
				dbData,
				description,
				orReplace,
				ifNotExist,
				partitioning,
				partitioningType,
				timeUnitPartitionKey,
				partitioningFilterRequired,
				rangeOptions,
				temporary,
				expiration,
				tableType,
				clusteringKey,
				customerEncryptionKey,
				labels,
				friendlyName,
			},
			isActivated,
		) {
			const tableName = getFullName(dbData.projectId, dbData.databaseName, name);
			const orReplaceTable = orReplace ? 'OR REPLACE ' : '';
			const temporaryTable = temporary ? 'TEMPORARY ' : '';
			const ifNotExistTable = ifNotExist ? 'IF NOT EXISTS ' : '';
			const isPartitionActivated = isActivatedPartition({
				partitioning,
				timeUnitPartitionKey,
				rangeOptions,
			});
			const partitions = getTablePartitioning({
				partitioning,
				partitioningType,
				timeUnitPartitionKey,
				rangeOptions,
			});
			const clustering = getClusteringKey(clusteringKey, isActivated);
			const isExternal = tableType === 'External';
			const options = getTableOptions(
				tab,
				getLabels,
			)({
				partitioningFilterRequired: isExternal ? false : partitioningFilterRequired,
				customerEncryptionKey,
				partitioning,
				friendlyName,
				description,
				expiration,
				labels,
			});
			const external = isExternal ? 'EXTERNAL ' : '';
			const activatedColumns = columns.filter(column => column.isActivated).map(({ column }) => column);
			const deActivatedColumns = columns.filter(column => !column.isActivated).map(({ column }) => column);
			const partitionsStatement = commentIfDeactivated(partitions, { isActivated: isPartitionActivated });

			const tableStatement = assignTemplates(templates.createTable, {
				name: tableName,
				column_definitions: tab(
					[activatedColumns.join(',\n'), deActivatedColumns.join(',\n')].filter(Boolean).join('\n'),
				),
				orReplace: orReplaceTable,
				temporary: temporaryTable,
				ifNotExist: ifNotExistTable,
				partitions: partitionsStatement && !isExternal ? '\n' + partitionsStatement : '',
				clustering: isExternal ? '' : clustering,
				external,
				options,
			});

			return tableStatement;
		},

		convertColumnDefinition(columnDefinition) {
			return {
				column: commentIfDeactivated(getColumnSchema({ assignTemplates, tab, templates })(columnDefinition), {
					isActivated: columnDefinition.isActivated,
				}),
				isActivated: columnDefinition.isActivated,
			};
		},

		createView(viewData, dbData, isActivated) {
			const viewName = getFullName(dbData.projectId, dbData.databaseName, viewData.name);
			const columns = viewData.materialized ? [] : viewData.keys.map(key => key.alias || key.name);
			const isPartitionActivated = isActivatedPartition({
				partitioning: viewData.partitioning,
				timeUnitPartitionKey: viewData.partitioningType,
				rangeOptions: viewData.rangeOptions,
			});
			const partitions = getTablePartitioning({
				partitioning: viewData.partitioning,
				partitioningType: viewData.partitioningType,
				timeUnitPartitionKey: viewData.timeUnitPartitionKey,
				rangeOptions: viewData.rangeOptions,
			});
			const clustering = getClusteringKey(viewData.clusteringKey, isActivated);
			const partitionsStatement = commentIfDeactivated(partitions, { isActivated: isPartitionActivated });

			return assignTemplates(templates.createView, {
				name: viewName,
				materialized: viewData.materialized ? 'MATERIALIZED ' : '',
				orReplace: viewData.orReplace && !viewData.materialized ? 'OR REPLACE ' : '',
				ifNotExist: viewData.ifNotExist ? 'IF NOT EXISTS ' : '',
				columns: columns.length ? `\n (${columns.join(', ')})` : '',
				selectStatement: `\n ${_.trim(
					viewData.selectStatement
						? viewData.selectStatement
						: generateViewSelectStatement(getFullName)({
								columns: viewData.keys,
								datasetName: dbData.databaseName,
								projectId: dbData.projectId,
						  }),
				)}`,
				options: getViewOptions(viewData),
				partitions: partitionsStatement ? '\n' + partitionsStatement : '',
				clustering,
			});
		},

		getDefaultType(type) {
			return defaultTypes[type];
		},

		getTypesDescriptors() {
			return types;
		},

		hasType(type) {
			return hasType(types, type);
		},

		hydrateColumn({ columnDefinition, jsonSchema, dbData }) {
			return {
				name: columnDefinition.name,
				type: columnDefinition.type,
				isActivated: columnDefinition.isActivated,
				description: jsonSchema.description,
				dataTypeMode: jsonSchema.dataTypeMode,
				jsonSchema,
			};
		},

		hydrateDatabase(containerData, data) {
			const modelData = data?.modelData;

			return {
				databaseName: containerData.name,
				friendlyName: containerData.businessName,
				description: containerData.description,
				isActivated: containerData.isActivated,
				ifNotExist: containerData.ifNotExist,
				projectId: modelData?.[0]?.projectID,
				defaultExpiration: containerData.enableTableExpiration ? containerData.defaultExpiration : '',
				customerEncryptionKey:
					containerData.encryption === 'Customer-managed' ? containerData.customerEncryptionKey : '',
				labels: Array.isArray(containerData.labels) ? containerData.labels : [],
			};
		},

		hydrateTable({ tableData, entityData, jsonSchema }) {
			const data = entityData[0];

			return {
				...tableData,
				name: data.code || data.collectionName,
				friendlyName: jsonSchema.title && jsonSchema.title !== data.collectionName ? jsonSchema.title : '',
				description: data.description,
				orReplace: data.orReplace,
				ifNotExist: data.ifNotExist,
				partitioning: data.partitioning,
				partitioningType: data.partitioningType,
				timeUnitPartitionKey: data.timeUnitpartitionKey,
				partitioningFilterRequired: data.partitioningFilterRequired,
				rangeOptions: data.rangeOptions,
				temporary: data.temporary,
				expiration: data.expiration,
				tableType: data.tableType,
				clusteringKey: data.clusteringKey,
				customerEncryptionKey: data.encryption ? data.customerEncryptionKey : '',
				labels: data.labels,
			};
		},

		hydrateViewColumn(data) {
			return {
				name: data.name,
				tableName: data.entityName,
				alias: data.alias,
			};
		},

		hydrateView({ viewData, entityData }) {
			const detailsTab = entityData[0];

			return {
				name: viewData.name,
				tableName: viewData.tableName,
				keys: viewData.keys,
				materialized: detailsTab.materialized,
				orReplace: detailsTab.orReplace,
				ifNotExist: detailsTab.ifNotExist,
				selectStatement: detailsTab.selectStatement,
				labels: detailsTab.labels,
				description: detailsTab.description,
				expiration: detailsTab.expiration,
				friendlyName: detailsTab.businessName,
				partitioning: detailsTab.partitioning,
				partitioningType: detailsTab.partitioningType,
				timeUnitPartitionKey: detailsTab.timeUnitpartitionKey,
				clusteringKey: detailsTab.clusteringKey,
				rangeOptions: detailsTab.rangeOptions,
				refreshInterval: detailsTab.refreshInterval,
				enableRefresh: detailsTab.enableRefresh,
			};
		},

		commentIfDeactivated(statement, data, isPartOfLine) {
			return commentIfDeactivated(statement, data, isPartOfLine);
		},

		// * statements for alter script from delta model
		dropDatabase(name) {
			return assignTemplates(templates.dropDatabase, { name });
		},

		alterDatabase({
			databaseName,
			friendlyName,
			description,
			projectId,
			defaultExpiration,
			customerEncryptionKey,
			labels,
		}) {
			return assignTemplates(templates.alterDatabase, {
				name: getFullName(projectId, databaseName),
				dbOptions: getContainerOptions({
					friendlyName,
					description,
					defaultExpiration,
					customerEncryptionKey,
					labels,
				}),
			});
		},

		dropTable(tableName, databaseName, projectId) {
			return assignTemplates(templates.dropTable, {
				name: getFullName(projectId, databaseName, tableName),
			});
		},

		alterTableOptions({
			name,
			dbData,
			description,
			partitioning,
			partitioningFilterRequired,
			expiration,
			tableType,
			customerEncryptionKey,
			labels,
			friendlyName,
		}) {
			const tableName = getFullName(dbData.projectId, dbData.databaseName, name);
			const isExternal = tableType === 'External';

			const options = getTableOptions(
				tab,
				getLabels,
			)({
				partitioningFilterRequired: isExternal ? false : partitioningFilterRequired,
				customerEncryptionKey,
				partitioning,
				friendlyName,
				description,
				expiration,
				labels,
			});

			return assignTemplates(templates.alterTable, {
				name: tableName,
				options,
			});
		},

		alterColumnOptions(tableName, columnName, description) {
			return assignTemplates(templates.alterColumnOptions, {
				description: escapeQuotes(description),
				tableName,
				columnName,
			});
		},

		alterColumnType(tableName, columnDefinition) {
			const columnSchema = getColumnSchema({ assignTemplates, tab, templates })(
				_.pick(columnDefinition, 'type', 'dataTypeMode', 'jsonSchema'),
			);

			return assignTemplates(templates.alterColumnType, {
				columnName: columnDefinition.name,
				type: columnSchema,
				tableName,
			});
		},

		alterColumnDropNotNull(tableName, columnName) {
			return assignTemplates(templates.alterColumnDropNotNull, {
				columnName,
				tableName,
			});
		},

		addColumn({ column }, tableName, dbData) {
			const fullTableName = getFullName(dbData.projectId, dbData.databaseName, tableName);

			return assignTemplates(templates.alterTableAddColumn, {
				tableName: fullTableName,
				column,
			});
		},

		dropColumn(columnName, tableName, dbData) {
			const fullTableName = getFullName(dbData.projectId, dbData.databaseName, tableName);

			return assignTemplates(templates.alterTableDropColumn, {
				tableName: fullTableName,
				columnName,
			});
		},

		dropView(viewName, databaseName, projectId) {
			return assignTemplates(templates.dropView, {
				name: getFullName(projectId, databaseName, viewName),
			});
		},

		alterView(viewData, dbData) {
			const viewName = getFullName(dbData.projectId, dbData.databaseName, viewData.name);

			return assignTemplates(templates.alterViewOptions, {
				materialized: viewData.materialized ? 'MATERIALIZED ' : '',
				name: viewName,
				options: getViewOptions(viewData),
			});
		},
	};
};
