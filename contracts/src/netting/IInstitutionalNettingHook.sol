// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {NettingTypes} from "./NettingTypes.sol";

interface IInstitutionalNettingHook {
    function poolManager() external view returns (IPoolManager);
    function authorizedRouter() external view returns (address);
    function supportedPoolId() external view returns (bytes32);

    function openBatch(
        NettingTypes.BatchHeader calldata header,
        NettingTypes.NettingOrder[] calldata orders,
        bytes[] calldata signatures
    ) external;

    function closeBatch(NettingTypes.BatchHeader calldata header) external;
}
